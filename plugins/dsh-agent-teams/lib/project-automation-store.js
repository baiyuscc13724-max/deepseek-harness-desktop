import { resolve } from "node:path";
import {
  appendLedgerEntry,
  approveRun,
  assertCommandReplay,
  assertTrustedAutomationApprover,
  createManualRun,
  createManualTrigger,
  failStep,
  hashAutomationInput,
  markStepRunning,
  normalizeAutomationCommand,
  normalizeAutomationCommandReceipt,
  normalizeAutomationDefinition,
  normalizeEffectReceipt,
  normalizeLedgerEntries,
  normalizePersistedApproval,
  normalizePersistedRun,
  reconcileRunFromEffectReceipt,
  rejectRun,
  requestRunCancel,
  retryFailedStep,
} from "./project-automation-domain.js";
import { EncryptedProjectStateStore } from "./project-state-store.js";

const MAX_AUTOMATION_DEFINITIONS = 100;
const MAX_AUTOMATION_RUNS = 1_000;
const MAX_AUTOMATION_LEDGER_ENTRIES = 10_000;
const MAX_AUTOMATION_COMMAND_RECEIPTS = 10_000;
const MAX_AUTOMATION_PLAINTEXT_BYTES = 16 * 1024 * 1024;
const DOCUMENT_KEYS = new Set(["definitions", "runs", "approvals", "commandReceipts", "ledger", "nextLedgerSequence"]);
const STATE_KEYS = new Set(["projectRef", ...DOCUMENT_KEYS]);
const AUTOMATION_CHAINS = new Map();

function storeError(message, code, details = {}) { const error = new Error(message); error.code = code; Object.assign(error, details); return error; }
function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function nonEmptyString(value, field, max = 2_000) { if (typeof value !== "string" || value.trim() === "" || value.length > max) throw new TypeError(`${field} must be a non-empty string of at most ${max} characters`); return value.trim(); }
function safeRevision(value, field) { if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${field} must be a non-negative safe integer`); return value; }
function positiveInteger(value, field) { if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${field} must be a positive safe integer`); return value; }
function trustedInputHash(value, fallback) { if (value === undefined) return fallback; if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) throw new TypeError("inputHash must be a lowercase SHA-256 hex digest"); return value; }
function isoTimestamp(value, field) { const result = nonEmptyString(value, field, 64); if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(result) || !Number.isFinite(Date.parse(result))) throw new TypeError(`${field} must be an offset ISO timestamp`); return result; }
function assertAllowedKeys(value, allowed, field) { if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${field} must be a plain object`); const extras = Object.keys(value).filter((key) => !allowed.has(key)); if (extras.length > 0) throw new TypeError(`${field} contains unsupported fields: ${extras.join(", ")}`); }
function cloneJson(value) { let text; try { text = JSON.stringify(value); } catch (error) { throw new TypeError(`automation state must be JSON serializable: ${String(error?.message ?? error)}`); } if (text === undefined) throw new TypeError("automation state must be JSON serializable"); return JSON.parse(text); }
function deepFreeze(value) { if (value !== null && typeof value === "object" && !Object.isFrozen(value)) { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); } return value; }
function queuePath(filePath, operation) { const previous = AUTOMATION_CHAINS.get(filePath) ?? Promise.resolve(); const result = previous.then(operation, operation); const settled = result.then(() => undefined, () => undefined); AUTOMATION_CHAINS.set(filePath, settled); void settled.finally(() => { if (AUTOMATION_CHAINS.get(filePath) === settled) AUTOMATION_CHAINS.delete(filePath); }); return result; }
function emptyDocument() { return { definitions: [], runs: [], approvals: [], commandReceipts: [], ledger: [], nextLedgerSequence: 1 }; }
function automationState(projectRef, document) { return { projectRef, ...document }; }
function assertPlaintextSize(state) { if (Buffer.byteLength(JSON.stringify(state), "utf8") > MAX_AUTOMATION_PLAINTEXT_BYTES) throw storeError("automation plaintext exceeds the 16 MiB limit", "PROJECT_AUTOMATION_LIMIT_EXCEEDED", { field: "plaintext", limit: MAX_AUTOMATION_PLAINTEXT_BYTES }); }

function validateDocument(input) {
  assertAllowedKeys(input, DOCUMENT_KEYS, "automation document");
  for (const [field, limit] of [["definitions", MAX_AUTOMATION_DEFINITIONS], ["runs", MAX_AUTOMATION_RUNS], ["approvals", MAX_AUTOMATION_RUNS], ["commandReceipts", MAX_AUTOMATION_COMMAND_RECEIPTS], ["ledger", MAX_AUTOMATION_LEDGER_ENTRIES]]) {
    if (!Array.isArray(input[field]) || input[field].length > limit) throw storeError(`automation ${field} exceeds its ${limit} item limit`, "PROJECT_AUTOMATION_LIMIT_EXCEEDED", { field, limit });
  }
  const definitions = input.definitions.map(normalizeAutomationDefinition);
  const runs = input.runs.map(normalizePersistedRun);
  const approvals = input.approvals.map(normalizePersistedApproval);
  const commandReceipts = input.commandReceipts.map(normalizeAutomationCommandReceipt);
  const ledger = normalizeLedgerEntries(input.ledger);
  const identities = [[definitions, "definitionRef", "definitions"], [runs, "runRef", "runs"], [approvals, "approvalRef", "approvals"], [commandReceipts, "commandId", "commandReceipts"]];
  for (const [items, key, field] of identities) if (new Set(items.map((item) => item[key])).size !== items.length) throw storeError(`automation ${field} contains duplicate identities`, "PROJECT_AUTOMATION_DOCUMENT_INVALID");
  const definitionByRef = new Map(definitions.map((item) => [item.definitionRef, item]));
  const runByRef = new Map(runs.map((item) => [item.runRef, item]));
  const approvalByRef = new Map(approvals.map((item) => [item.approvalRef, item]));
  for (const run of runs) {
    const current = definitionByRef.get(run.definitionRef);
    if (current !== undefined && current.revision < run.definitionRevision) throw storeError("run pins a future definition revision", "PROJECT_AUTOMATION_DOCUMENT_INVALID");
    for (const ref of run.approvalRefs) { const approval = approvalByRef.get(ref); if (approval?.runRef !== run.runRef || approval.stepRunRef !== run.steps[0].stepRunRef) throw storeError("run approval reference is missing or mismatched", "PROJECT_AUTOMATION_DOCUMENT_INVALID"); }
  }
  for (const approval of approvals) { const run = runByRef.get(approval.runRef); if (run === undefined || !run.approvalRefs.includes(approval.approvalRef) || approval.stepRunRef !== run.steps[0].stepRunRef) throw storeError("approval does not belong to its run", "PROJECT_AUTOMATION_DOCUMENT_INVALID"); }
  for (const receipt of commandReceipts) if (receipt.outcome === "accepted") {
    if (receipt.type.startsWith("definition.")) { const definition = definitionByRef.get(receipt.definitionRef); if (definition === undefined || definition.revision < receipt.resultRevision) throw storeError("definition receipt result is missing", "PROJECT_AUTOMATION_DOCUMENT_INVALID"); }
    else { const run = runByRef.get(receipt.runRef); if (run === undefined || run.revision < receipt.resultRevision) throw storeError("run receipt result is missing", "PROJECT_AUTOMATION_DOCUMENT_INVALID"); if (receipt.approvalRef !== undefined && approvalByRef.get(receipt.approvalRef)?.runRef !== run.runRef) throw storeError("approval receipt result is missing", "PROJECT_AUTOMATION_DOCUMENT_INVALID"); }
  }
  const nextLedgerSequence = positiveInteger(input.nextLedgerSequence, "automation document.nextLedgerSequence");
  if (nextLedgerSequence !== ledger.length + 1) throw storeError("automation ledger cursor does not follow the hash chain", "PROJECT_AUTOMATION_LEDGER_INVALID");
  return deepFreeze({ definitions, runs, approvals, commandReceipts, ledger, nextLedgerSequence });
}

class ProjectAutomationStore {
  #stateStore;
  #closing = false;
  #closed = false;
  #closePromise;

  constructor({ projectRef, filePath, encryptionKey, minimumRevision = 0 } = {}) {
    this.projectRef = nonEmptyString(projectRef, "projectRef", 128);
    this.filePath = resolve(nonEmptyString(filePath, "filePath", 4_096));
    if ((!Buffer.isBuffer(encryptionKey) && !(encryptionKey instanceof Uint8Array)) || encryptionKey.byteLength !== 32) throw new TypeError("automation encryptionKey must contain exactly 32 bytes");
    this.#stateStore = new EncryptedProjectStateStore(this.filePath, { projectRef: this.projectRef, encryptionKey: Buffer.from(encryptionKey), minimumRevision });
  }

  toJSON() { return { projectRef: this.projectRef, closing: this.#closing, closed: this.#closed }; }
  async load() { return this.#enqueue(() => this.#loadUnlocked()); }

  async saveDefinition({ definition: inputDefinition, commandId: inputCommandId, inputHash: providedInputHash, expectedRevision, completedAt } = {}) {
    this.#assertOpen();
    const definition = normalizeAutomationDefinition(inputDefinition), commandId = nonEmptyString(inputCommandId, "commandId", 256), timestamp = isoTimestamp(completedAt, "completedAt");
    const type = definition.revision === 1 ? "definition.create" : "definition.update", inputHash = trustedInputHash(providedInputHash, hashAutomationInput({ type, definition }));
    return this.#enqueue(async () => {
      const loaded = await this.#loadUnlocked(), existing = loaded.document.commandReceipts.find((item) => item.commandId === commandId);
      if (existing !== undefined) { assertCommandReplay(existing, { commandId, inputHash }); if (existing.type !== type) throw storeError("automation command receipt type changed", "PROJECT_AUTOMATION_IDEMPOTENCY_CONFLICT"); return deepFreeze({ duplicate: true, revision: loaded.revision, receipt: existing }); }
      this.#assertRevision(loaded.revision, expectedRevision);
      const document = cloneJson(loaded.document), index = document.definitions.findIndex((item) => item.definitionRef === definition.definitionRef);
      if (index < 0 ? definition.revision !== 1 : definition.revision !== document.definitions[index].revision + 1) throw storeError("definition revision is not the next revision", "PROJECT_AUTOMATION_CONFLICT", { currentRevision: index < 0 ? 0 : document.definitions[index].revision });
      if (index < 0) document.definitions.push(definition); else document.definitions[index] = definition;
      this.#append(document, { type: index < 0 ? "definition.created" : "definition.updated", commandId, inputHash, definitionRef: definition.definitionRef, definitionRevision: definition.revision, occurredAt: timestamp });
      const receipt = normalizeAutomationCommandReceipt({ commandId, inputHash, type, outcome: "accepted", definitionRef: definition.definitionRef, resultRevision: definition.revision, completedAt: timestamp });
      document.commandReceipts.push(receipt);
      const saved = await this.#saveUnlocked(document, loaded.revision);
      return deepFreeze({ duplicate: false, revision: saved.revision, receipt });
    });
  }

  async executeCommand({ command: inputCommand, trustedActor, inputHash: providedInputHash, expectedRevision, completedAt } = {}) {
    this.#assertOpen();
    const command = normalizeAutomationCommand(inputCommand), timestamp = isoTimestamp(completedAt, "completedAt");
    const actor = command.type === "manual_run" ? undefined : assertTrustedAutomationApprover(trustedActor);
    const inputHash = trustedInputHash(providedInputHash, command.inputHash), executionCommand = deepFreeze({ ...command, inputHash });
    return this.#enqueue(async () => {
      const loaded = await this.#loadUnlocked(), existing = loaded.document.commandReceipts.find((item) => item.commandId === executionCommand.commandId);
      if (existing !== undefined) { assertCommandReplay(existing, executionCommand); if (existing.type !== executionCommand.type) throw storeError("automation command receipt type changed", "PROJECT_AUTOMATION_IDEMPOTENCY_CONFLICT"); return deepFreeze({ duplicate: true, revision: loaded.revision, receipt: existing }); }
      this.#assertRevision(loaded.revision, expectedRevision);
      const document = cloneJson(loaded.document);
      let run, approval;
      if (executionCommand.type === "manual_run") run = this.#createRun(document, executionCommand, timestamp);
      else if (executionCommand.type === "approve" || executionCommand.type === "reject") ({ run, approval } = this.#decideRun(document, executionCommand, trustedActor, actor, timestamp));
      else if (executionCommand.type === "retry") run = this.#retryRun(document, executionCommand, trustedActor, timestamp);
      else run = this.#cancelRun(document, executionCommand, trustedActor, timestamp);
      const receipt = normalizeAutomationCommandReceipt({ commandId: executionCommand.commandId, inputHash, type: executionCommand.type, outcome: "accepted", ...(executionCommand.type === "manual_run" ? { definitionRef: run.definitionRef } : {}), runRef: run.runRef, ...(approval === undefined ? {} : { approvalRef: approval.approvalRef }), resultRevision: run.revision, completedAt: timestamp });
      document.commandReceipts.push(receipt);
      const saved = await this.#saveUnlocked(document, loaded.revision);
      return deepFreeze({ duplicate: false, revision: saved.revision, receipt });
    });
  }

  async saveRejectedCommandReceipt({ receipt: inputReceipt, expectedRevision } = {}) {
    this.#assertOpen();
    const receipt = normalizeAutomationCommandReceipt(inputReceipt);
    if (receipt.outcome !== "rejected") throw new TypeError("saveRejectedCommandReceipt requires a rejected receipt");
    return this.#enqueue(async () => {
      const loaded = await this.#loadUnlocked(), existing = loaded.document.commandReceipts.find((item) => item.commandId === receipt.commandId);
      if (existing !== undefined) {
        assertCommandReplay(existing, receipt);
        if (existing.type !== receipt.type) throw storeError("automation command receipt type changed", "PROJECT_AUTOMATION_IDEMPOTENCY_CONFLICT");
        return deepFreeze({ duplicate: true, revision: loaded.revision, receipt: existing });
      }
      this.#assertRevision(loaded.revision, expectedRevision);
      const document = cloneJson(loaded.document);
      document.commandReceipts.push(receipt);
      const saved = await this.#saveUnlocked(document, loaded.revision);
      return deepFreeze({ duplicate: false, revision: saved.revision, receipt });
    });
  }

  async startRun({ runRef: inputRunRef, expectedRunRevision, expectedRevision, startedAt } = {}) {
    this.#assertOpen();
    const runRef = nonEmptyString(inputRunRef, "runRef", 256), timestamp = isoTimestamp(startedAt, "startedAt");
    return this.#mutate(expectedRevision, (document) => {
      const index = this.#runIndex(document, runRef), current = document.runs[index]; this.#assertRunRevision(current, expectedRunRevision);
      const run = markStepRunning(current, { startedAt: timestamp }); document.runs[index] = run; const step = run.steps[0];
      this.#append(document, { runRef, type: "run.started", fromStatus: current.status, toStatus: run.status, occurredAt: timestamp });
      this.#append(document, { runRef, stepRunRef: step.stepRunRef, effectKey: step.effectKey, taskCommandId: step.taskCommandId, attempt: step.attempt, type: "step.started", fromStatus: current.steps[0].status, toStatus: step.status, occurredAt: timestamp });
      return run;
    });
  }

  async failRun({ runRef: inputRunRef, expectedRunRevision, expectedRevision, errorCode, retryable, finishedAt } = {}) {
    this.#assertOpen();
    const runRef = nonEmptyString(inputRunRef, "runRef", 256), timestamp = isoTimestamp(finishedAt, "finishedAt");
    return this.#mutate(expectedRevision, (document) => {
      const index = this.#runIndex(document, runRef), current = document.runs[index]; this.#assertRunRevision(current, expectedRunRevision);
      const run = failStep(current, { errorCode, retryable, finishedAt: timestamp }); document.runs[index] = run; const step = run.steps[0];
      this.#append(document, { runRef, stepRunRef: step.stepRunRef, effectKey: step.effectKey, taskCommandId: step.taskCommandId, attempt: step.attempt, type: "step.failed", errorCode: run.error.code, fromStatus: current.steps[0].status, toStatus: step.status, occurredAt: timestamp });
      this.#append(document, { runRef, type: "run.failed", errorCode: run.error.code, fromStatus: current.status, toStatus: run.status, occurredAt: timestamp });
      return run;
    });
  }

  async reconcileEffectReceipt({ runRef: inputRunRef, receipt: inputReceipt, expectedRevision } = {}) {
    this.#assertOpen();
    const runRef = nonEmptyString(inputRunRef, "runRef", 256), receipt = normalizeEffectReceipt(inputReceipt);
    return this.#enqueue(async () => {
      const loaded = await this.#loadUnlocked(), index = this.#runIndex(loaded.document, runRef), current = loaded.document.runs[index], step = current.steps[0];
      if (receipt.effectKey !== step.effectKey || receipt.taskCommandId !== step.taskCommandId) throw storeError("effect receipt does not match the pinned run", "PROJECT_AUTOMATION_RECEIPT_CONFLICT");
      if (receipt.status === "unknown") return deepFreeze({ duplicate: false, revision: loaded.revision, run: current, committed: false });
      if (["succeeded", "failed", "canceled"].includes(current.status)) {
        if (!this.#terminalMatches(current, receipt)) throw storeError("terminal effect receipt changed", "PROJECT_AUTOMATION_RECEIPT_CONFLICT");
        return deepFreeze({ duplicate: true, revision: loaded.revision, run: current, committed: true });
      }
      this.#assertRevision(loaded.revision, expectedRevision);
      const document = cloneJson(loaded.document), run = reconcileRunFromEffectReceipt(current, receipt); document.runs[index] = run; const terminal = run.steps[0], timestamp = receipt.finishedAt;
      if (receipt.status === "succeeded") {
        const audit = { runRef, stepRunRef: terminal.stepRunRef, effectKey: terminal.effectKey, taskCommandId: terminal.taskCommandId, resultReceiptRef: terminal.resultReceiptRef, attempt: terminal.attempt, fromStatus: step.status, toStatus: terminal.status, occurredAt: timestamp };
        this.#append(document, { ...audit, type: "step.effect_committed" }); this.#append(document, { ...audit, type: "step.succeeded" }); this.#append(document, { runRef, type: "run.succeeded", fromStatus: current.status, toStatus: run.status, occurredAt: timestamp });
      } else if (receipt.status === "failed") {
        this.#append(document, { runRef, stepRunRef: terminal.stepRunRef, effectKey: terminal.effectKey, taskCommandId: terminal.taskCommandId, attempt: terminal.attempt, type: "step.failed", errorCode: run.error.code, fromStatus: step.status, toStatus: terminal.status, occurredAt: timestamp }); this.#append(document, { runRef, type: "run.failed", errorCode: run.error.code, fromStatus: current.status, toStatus: run.status, occurredAt: timestamp });
      } else {
        this.#append(document, { runRef, stepRunRef: terminal.stepRunRef, effectKey: terminal.effectKey, taskCommandId: terminal.taskCommandId, attempt: terminal.attempt, type: "step.canceled", fromStatus: step.status, toStatus: terminal.status, occurredAt: timestamp }); this.#append(document, { runRef, type: "run.canceled", fromStatus: current.status, toStatus: run.status, occurredAt: timestamp });
      }
      const saved = await this.#saveUnlocked(document, loaded.revision);
      return deepFreeze({ duplicate: false, revision: saved.revision, run, committed: true });
    });
  }

  close() {
    if (this.#closePromise !== undefined) return this.#closePromise;
    this.#closing = true;
    const tail = AUTOMATION_CHAINS.get(this.filePath) ?? Promise.resolve();
    this.#closePromise = tail.then(() => this.#stateStore.close(), () => this.#stateStore.close()).then(() => { this.#closed = true; });
    return this.#closePromise;
  }

  #enqueue(operation) { this.#assertOpen(); return queuePath(this.filePath, operation); }
  #assertOpen() { if (!this.#closing && !this.#closed) return; throw storeError("project automation store is closed", "PROJECT_STATE_CLOSED"); }
  async #loadUnlocked() {
    const loaded = await this.#stateStore.load(); if (loaded === undefined) return deepFreeze({ revision: 0, document: deepFreeze(emptyDocument()) });
    assertPlaintextSize(loaded.state); assertAllowedKeys(loaded.state, STATE_KEYS, "automation encrypted state"); if (loaded.state.projectRef !== this.projectRef) throw storeError("automation state belongs to another project", "PROJECT_AUTOMATION_PROJECT_MISMATCH");
    const { projectRef: ignoredProjectRef, ...document } = loaded.state; void ignoredProjectRef;
    return deepFreeze({ revision: loaded.revision, document: validateDocument(document) });
  }
  async #saveUnlocked(candidate, expectedRevision) {
    const document = validateDocument(candidate), state = automationState(this.projectRef, document); assertPlaintextSize(state);
    try { const saved = await this.#stateStore.save(state, { expectedRevision }); return { revision: saved.revision, document }; }
    catch (error) { if (error?.code === "PROJECT_STATE_CONFLICT") throw storeError("automation store compare-and-swap revision changed", "PROJECT_AUTOMATION_STORE_CONFLICT", { currentRevision: error.currentRevision }); throw error; }
  }
  #mutate(expectedRevision, operation) { return this.#enqueue(async () => { const loaded = await this.#loadUnlocked(); this.#assertRevision(loaded.revision, expectedRevision); const document = cloneJson(loaded.document), result = operation(document); const saved = await this.#saveUnlocked(document, loaded.revision); return deepFreeze({ revision: saved.revision, run: result }); }); }
  #assertRevision(current, expected) { safeRevision(expected, "expectedRevision"); if (current !== expected) throw storeError("automation store compare-and-swap revision changed", "PROJECT_AUTOMATION_STORE_CONFLICT", { currentRevision: current }); }
  #assertRunRevision(run, expected) { positiveInteger(expected, "expectedRunRevision"); if (run.revision !== expected) throw storeError("automation run revision changed", "PROJECT_AUTOMATION_CONFLICT", { currentRevision: run.revision }); }
  #runIndex(document, runRef) { const index = document.runs.findIndex((item) => item.runRef === runRef); if (index < 0) throw storeError("automation run was not found", "PROJECT_AUTOMATION_RUN_NOT_FOUND"); return index; }
  #append(document, input) { if (document.ledger.length >= MAX_AUTOMATION_LEDGER_ENTRIES) throw storeError("automation ledger reached its item limit", "PROJECT_AUTOMATION_LIMIT_EXCEEDED", { field: "ledger", limit: MAX_AUTOMATION_LEDGER_ENTRIES }); const sequence = document.nextLedgerSequence; document.ledger = appendLedgerEntry(document.ledger, { entryRef: `automation_entry_${String(sequence).padStart(12, "0")}`, ledgerRef: `automation_ledger_${this.projectRef}`, ...input }); document.nextLedgerSequence = sequence + 1; }
  #createRun(document, command, timestamp) {
    const definition = document.definitions.find((item) => item.definitionRef === command.payload.definitionRef); if (definition === undefined) throw storeError("automation definition was not found", "PROJECT_AUTOMATION_DEFINITION_NOT_FOUND"); if (definition.revision !== command.payload.definitionRevision) throw storeError("automation definition revision changed", "PROJECT_AUTOMATION_DEFINITION_STALE");
    const trigger = createManualTrigger(definition, { triggerRef: command.payload.triggerRef, commandId: command.commandId, requestedAt: timestamp, input: { taskRef: command.payload.taskRef, expectedTaskRevision: command.payload.expectedTaskRevision } }); const run = createManualRun(definition, trigger, { runRef: command.payload.runRef, createdAt: timestamp }); if (document.runs.some((item) => item.runRef === run.runRef)) throw storeError("automation run already exists", "PROJECT_AUTOMATION_CONFLICT"); document.runs.push(run);
    const audit = { runRef: run.runRef, definitionRef: run.definitionRef, definitionRevision: run.definitionRevision, triggerRef: run.triggerRef, commandId: command.commandId, inputHash: command.inputHash, fromStatus: "none", toStatus: run.status, occurredAt: timestamp }; this.#append(document, { ...audit, type: "run.triggered" }); this.#append(document, { ...audit, type: "run.created" }); return run;
  }
  #decideRun(document, command, trustedActor, actor, timestamp) {
    const index = this.#runIndex(document, command.payload.runRef), current = document.runs[index], input = { approvalRef: command.payload.approvalRef, commandId: command.commandId, expectedRunRevision: command.expectedRunRevision, decidedAt: timestamp }; const decided = command.type === "approve" ? approveRun(current, input, trustedActor) : rejectRun(current, input, trustedActor); if (document.approvals.some((item) => item.approvalRef === decided.approval.approvalRef)) throw storeError("automation approval already exists", "PROJECT_AUTOMATION_CONFLICT"); document.approvals.push(decided.approval); document.runs[index] = decided.run; const step = decided.run.steps[0];
    const audit = { runRef: current.runRef, stepRunRef: step.stepRunRef, approvalRef: decided.approval.approvalRef, actorRef: actor.actorRef, actorRole: actor.actorRole, commandId: command.commandId, inputHash: command.inputHash, fromStatus: current.status, toStatus: decided.run.status, occurredAt: timestamp }; this.#append(document, { ...audit, type: "approval.recorded" }); this.#append(document, { ...audit, type: command.type === "approve" ? "approval.approved" : "approval.rejected", ...(command.payload.reasonCode === undefined ? {} : { reasonCode: command.payload.reasonCode }) });
    if (command.type === "approve") { const stepAudit = { runRef: current.runRef, stepRunRef: step.stepRunRef, effectKey: step.effectKey, taskCommandId: step.taskCommandId, attempt: step.attempt, fromStatus: current.steps[0].status, toStatus: step.status, occurredAt: timestamp }; this.#append(document, { ...stepAudit, type: "step.queued" }); this.#append(document, { runRef: current.runRef, type: "run.queued", fromStatus: current.status, toStatus: decided.run.status, occurredAt: timestamp }); }
    else { this.#append(document, { runRef: current.runRef, stepRunRef: step.stepRunRef, effectKey: step.effectKey, taskCommandId: step.taskCommandId, attempt: step.attempt, type: "step.canceled", fromStatus: current.steps[0].status, toStatus: step.status, occurredAt: timestamp }); this.#append(document, { runRef: current.runRef, type: "run.canceled", fromStatus: current.status, toStatus: decided.run.status, occurredAt: timestamp }); }
    return decided;
  }
  #retryRun(document, command, trustedActor, timestamp) {
    const index = this.#runIndex(document, command.payload.runRef), current = document.runs[index], run = retryFailedStep(current.definitionSnapshot, current, { commandId: command.commandId, expectedRunRevision: command.expectedRunRevision, requestedAt: timestamp }, trustedActor); document.runs[index] = run; const step = run.steps[0];
    const audit = { runRef: run.runRef, stepRunRef: step.stepRunRef, effectKey: step.effectKey, taskCommandId: step.taskCommandId, attempt: step.attempt, commandId: command.commandId, inputHash: command.inputHash, fromStatus: current.steps[0].status, toStatus: step.status, occurredAt: timestamp };
    this.#append(document, { ...audit, type: "retry.requested", reasonCode: command.payload.reasonCode ?? "retry_requested" });
    this.#append(document, { ...audit, type: "step.retried", reasonCode: command.payload.reasonCode ?? "retry_requested" });
    this.#append(document, { ...audit, type: "step.queued" });
    this.#append(document, { runRef: run.runRef, type: "run.queued", fromStatus: current.status, toStatus: run.status, occurredAt: timestamp }); return run;
  }
  #cancelRun(document, command, trustedActor, timestamp) {
    const index = this.#runIndex(document, command.payload.runRef), current = document.runs[index], run = requestRunCancel(current, { commandId: command.commandId, expectedRunRevision: command.expectedRunRevision, requestedAt: timestamp }, trustedActor); document.runs[index] = run; this.#append(document, { runRef: run.runRef, ...(run.steps[0]?.stepRunRef === undefined ? {} : { stepRunRef: run.steps[0].stepRunRef }), type: "cancel.requested", commandId: command.commandId, inputHash: command.inputHash, reasonCode: command.payload.reasonCode ?? "cancel_requested", fromStatus: current.status, toStatus: run.status, occurredAt: timestamp });
    if (run.status === "canceled") { const step = run.steps[0]; this.#append(document, { runRef: run.runRef, stepRunRef: step.stepRunRef, effectKey: step.effectKey, taskCommandId: step.taskCommandId, attempt: step.attempt, type: "step.canceled", fromStatus: current.steps[0].status, toStatus: step.status, occurredAt: timestamp }); this.#append(document, { runRef: run.runRef, type: "run.canceled", fromStatus: current.status, toStatus: run.status, occurredAt: timestamp }); } else this.#append(document, { runRef: run.runRef, type: "run.cancel_requested", fromStatus: current.status, toStatus: run.status, occurredAt: timestamp }); return run;
  }
  #terminalMatches(run, receipt) { const step = run.steps[0]; if (receipt.status === "succeeded") return run.status === "succeeded" && step.resultReceiptRef === receipt.resultReceiptRef && step.finishedAt === receipt.finishedAt; if (receipt.status === "failed") return run.status === "failed" && step.error?.code === receipt.errorCode && step.error?.retryable === receipt.retryable && step.finishedAt === receipt.finishedAt; return receipt.status === "not_committed" && run.status === "canceled" && run.startedAt !== undefined && run.cancelRequestedAt !== undefined && step.finishedAt === receipt.finishedAt; }
}

export { MAX_AUTOMATION_COMMAND_RECEIPTS, MAX_AUTOMATION_DEFINITIONS, MAX_AUTOMATION_LEDGER_ENTRIES, MAX_AUTOMATION_PLAINTEXT_BYTES, MAX_AUTOMATION_RUNS, ProjectAutomationStore, validateDocument as validateAutomationDocument };
