import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import net from "node:net";
import { dirname, join } from "node:path";

const VERSION = 1;
const TERMINAL = new Set(["ready", "failed", "cancelled"]);
const PUBLIC_SLOT_STATES = new Set(["reserving", "reserved", "reservation_failed", "queued", "starting", "ready", "failed", "outcome_unknown", "cancelled"]);
const BATCH_STATES = new Set(["reserving", "prepared", "reservation_failed", "queued", "starting", "partial", "ready", "stopping", "stopped", "failed", "outcome_unknown"]);
const PROVIDER_METHODS = ["resolveProject", "reserveAdoption", "launch", "reconcile", "cancel", "redeemAdoption"];
const ENDPOINT_ENV = "HARNESS_DESKTOP_SESSION_LAUNCH_ENDPOINT";
const TOKEN_ENV = "HARNESS_DESKTOP_SESSION_LAUNCH_TOKEN";
const CALLER_SALT_ENV = "DSH_AGENT_TEAMS_SESSION_LAUNCH_CALLER_SALT";
const MAX_PROVIDER_RESPONSE_BYTES = 64 * 1024;

function fail(message, code = "PROJECT_SESSION_LAUNCH_INVALID") { const error = new Error(message); error.code = code; throw error; }
function text(value, field, max = 4096) { if (typeof value !== "string" || value.trim().length === 0 || value.length > max) fail(`${field} must be a non-empty string of at most ${max} characters`); return value.trim(); }
function integer(value, field, min, max) { if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${field} must be an integer from ${min} through ${max}`); return value; }
function record(value, field) { if (typeof value !== "object" || value === null || Array.isArray(value)) fail(`${field} must be an object`); return value; }
function clone(value) { return structuredClone(value); }
function timestamp(clock) { return new Date(clock()).toISOString(); }
async function replaceFile(source, destination) {
  const deadline = Date.now() + 5_000;
  let delay = 10;
  for (;;) {
    try { await rename(source, destination); return; }
    catch (error) {
      if (!new Set(["EPERM", "EBUSY", "EACCES"]).has(error?.code) || Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, 250);
    }
  }
}
function digest(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function opaque(secret, kind, ...parts) { return `${kind}_${createHash("sha256").update(secret).update("\0").update(kind).update("\0").update(JSON.stringify(parts)).digest("base64url").slice(0, 32)}`; }
function normalizeBoundary(value, field) { const normalized = text(value, field, 256).normalize("NFKC").replace(/\\/gu, "/").replace(/\/{2,}/gu, "/"); if (normalized.split("/").includes("..") || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(normalized)) fail(`${field} is invalid`); return normalized; }
function requirementsText(value, field) { if (typeof value !== "string" || value.length === 0) fail(`${field} must be a non-empty string`); if (Buffer.byteLength(JSON.stringify(value), "utf8") > 65_536) fail(`${field} canonical JSON exceeds 65536 UTF-8 bytes`); return value; }
function normalizeSlots(value, expected) {
  if (!Array.isArray(value) || value.length !== expected) fail(`slots must contain exactly ${expected} entries`, "PROJECT_SESSION_LAUNCH_SLOT_COUNT");
  return value.map((candidate, index) => {
    const slot = record(candidate, `slots[${index}]`);
    const resources = Array.isArray(slot.resources) && slot.resources.length <= 64 ? slot.resources.map((item, itemIndex) => normalizeBoundary(item, `slots[${index}].resources[${itemIndex}]`)) : [];
    const resourceBytes = Buffer.byteLength(resources.join("\n"), "utf8");
    if (resources.length === 0 || new Set(resources).size !== resources.length || resourceBytes > 16 * 1024) fail(`slots[${index}].resources must be a non-empty unique list of at most 64 project-relative boundaries and 16 KiB total`);
    return { title: text(slot.title, `slots[${index}].title`, 160), role: text(slot.role, `slots[${index}].role`, 500), resources, task: requirementsText(slot.task, `slots[${index}].task`) };
  });
}
function assertProvider(provider) {
  if (typeof provider !== "object" || provider === null || Array.isArray(provider)) return undefined;
  if (typeof provider.callerRootRef !== "function") return undefined;
  for (const method of PROVIDER_METHODS) if (typeof provider[method] !== "function") return undefined;
  return { ...provider, retry: typeof provider.retry === "function" ? provider.retry.bind(provider) : async () => { throw providerError("PROJECT_SESSION_LAUNCH_RETRY_UNAVAILABLE", true); }, resolveUnknown: typeof provider.resolveUnknown === "function" ? provider.resolveUnknown.bind(provider) : async () => { throw providerError("PROJECT_SESSION_LAUNCH_RECONCILIATION_UNAVAILABLE", true); }, recordAdoption: typeof provider.recordAdoption === "function" ? provider.recordAdoption.bind(provider) : async () => { throw providerError("PROJECT_SESSION_ADOPTION_RECORD_UNAVAILABLE", true); }, recordFailure: typeof provider.recordFailure === "function" ? provider.recordFailure.bind(provider) : async () => { throw providerError("PROJECT_SESSION_LIFECYCLE_EVIDENCE_UNAVAILABLE", true); } };
}
function boundedUtf8(value, maxChars, maxBytes) { let result = "", chars = 0, bytes = 0; for (const character of value) { const size = Buffer.byteLength(character, "utf8"); if (chars >= maxChars || bytes + size > maxBytes) break; result += character; chars += 1; bytes += size; } return result; }
function publicSlot(slot) { return { slotRef: slot.slotRef, taskRef: slot.taskRef, title: slot.title, role: slot.role, resources: [...slot.resources], task: boundedUtf8(slot.task, 1_500, 4 * 1024), taskTruncated: Buffer.byteLength(slot.task, "utf8") > Buffer.byteLength(boundedUtf8(slot.task, 1_500, 4 * 1024), "utf8"), state: slot.state, ...(Number.isSafeInteger(slot.hostRevision) ? { reconciliationRevision: slot.hostRevision } : {}), ...(slot.errorCode ? { errorCode: slot.errorCode } : {}) }; }
function normalizeReservations(value, expected) {
  if (!Array.isArray(value) || value.length !== expected) fail(`reservations must contain exactly ${expected} entries`, "PROJECT_SESSION_LAUNCH_RESERVATION_COUNT");
  return value.map((entry, index) => { const reservation = record(entry, `reservations[${index}]`); return { slotActorRef: text(reservation.slotActorRef, `reservations[${index}].slotActorRef`, 256), taskRef: text(reservation.taskRef, `reservations[${index}].taskRef`, 256), slotRef: text(reservation.slotRef, `reservations[${index}].slotRef`, 128), operationRef: text(reservation.operationRef, `reservations[${index}].operationRef`, 128) }; });
}
function deriveBatchState(batch) {
  const states = batch.slots.map((slot) => slot.state);
  if (states.every((state) => state === "cancelled")) return "stopped";
  if (batch.noHostEffects === true) {
    if (states.some((state) => state === "reservation_failed")) return "reservation_failed";
    if (states.every((state) => state === "reserved")) return "prepared";
    return "reserving";
  }
  if (states.some((state) => state === "outcome_unknown")) return "outcome_unknown";
  if (states.every((state) => state === "ready")) return "ready";
  if (states.every((state) => state === "failed" || state === "cancelled")) return "failed";
  if (states.some((state) => TERMINAL.has(state)) && !states.every((state) => state === states[0])) return "partial";
  if (states.some((state) => state === "starting")) return "starting";
  return batch.stopRequested ? "stopping" : "queued";
}
function validateDocument(document) {
  record(document, "session launch store");
  if (document.version !== VERSION || typeof document.secret !== "string" || !Array.isArray(document.batches)) fail("session launch store is invalid", "PROJECT_SESSION_LAUNCH_STORE_INVALID");
  for (const batch of document.batches) {
    record(batch, "batch"); text(batch.batchRef, "batch.batchRef", 128); text(batch.projectRef, "batch.projectRef", 256); text(batch.requestId, "batch.requestId", 256);
    if (!BATCH_STATES.has(batch.state) || !Array.isArray(batch.slots)) fail("persisted batch is invalid", "PROJECT_SESSION_LAUNCH_STORE_INVALID");
    for (const slot of batch.slots) if (!PUBLIC_SLOT_STATES.has(slot.state)) fail("persisted slot is invalid", "PROJECT_SESSION_LAUNCH_STORE_INVALID");
  }
  return document;
}
function validEndpoint(value, platform = process.platform) {
  if (typeof value !== "string" || value.length === 0 || value.length > 1024 || value.includes("\0")) return false;
  return platform === "win32" ? value.startsWith("\\\\.\\pipe\\dsh-agent-teams-session-launch-") : value.startsWith("/");
}
function providerError(code = "PROJECT_SESSION_LAUNCH_HOST_UNAVAILABLE", definitive = false) { const error = new Error("Desktop Host project session launch capability is unavailable"); error.code = code; if (definitive) error.definitive = true; return error; }
function consumeDesktopProjectSessionLaunchCapability({ env = process.env, connect = net.createConnection, platform = process.platform, timeoutMs = 130_000 } = {}) {
  let endpoint, tokenText, callerSaltText, cleared = true;
  try { endpoint = env?.[ENDPOINT_ENV]; tokenText = env?.[TOKEN_ENV]; callerSaltText = env?.[CALLER_SALT_ENV]; } catch { cleared = false; }
  finally { if (env !== null && typeof env === "object") for (const key of [ENDPOINT_ENV, TOKEN_ENV, CALLER_SALT_ENV]) try { if (!Reflect.deleteProperty(env, key)) cleared = false; } catch { cleared = false; } }
  let token, callerSalt;
  try { token = Buffer.from(tokenText ?? "", "base64url"); callerSalt = Buffer.from(callerSaltText ?? "", "base64url"); } catch {}
  if (!cleared || !validEndpoint(endpoint, platform) || token?.length !== 32 || token.toString("base64url") !== tokenText || callerSalt?.length !== 32 || callerSalt.toString("base64url") !== callerSaltText) { token?.fill(0); callerSalt?.fill(0); return undefined; }
  let disposed = false;
  const request = (action, payload = {}) => new Promise((resolve, reject) => {
    if (disposed) return reject(providerError());
    const socket = connect(endpoint); let response = "", bytes = 0, settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => socket.destroy(providerError()), timeoutMs);
    socket.setEncoding("utf8");
    socket.once("connect", () => socket.write(`${JSON.stringify({ action, token: token.toString("base64url"), ...payload })}\n`));
    socket.on("data", chunk => { bytes += Buffer.byteLength(chunk); if (bytes > MAX_PROVIDER_RESPONSE_BYTES) return socket.destroy(providerError()); response += chunk; });
    socket.once("error", () => finish(providerError()));
    socket.once("end", () => {
      let parsed;
      try { parsed = JSON.parse(response.trim()); } catch { return finish(providerError()); }
      if (parsed?.ok === true && isRecordResult(parsed.result)) return finish(undefined, parsed.result);
      const code = typeof parsed?.code === "string" ? parsed.code.replace(/^HOST_/u, "PROJECT_") : "PROJECT_SESSION_LAUNCH_HOST_UNAVAILABLE";
      finish(providerError(code, parsed?.definitive === true));
    });
  });
  const dispose = () => { if (disposed) return false; disposed = true; token.fill(0); callerSalt.fill(0); return true; };
  const provider = { callerRootRef: (canonicalProjectKey, rootId) => createHmac("sha256", callerSalt).update(JSON.stringify(["agent-teams-caller-root-v1", canonicalProjectKey, rootId])).digest("hex"), resolveProject: (_execution, payload) => request("resolveProject", payload), reserveAdoption: (_execution, payload) => request("reserveAdoption", payload), launch: (_execution, payload) => request("launch", payload), retry: (_execution, payload) => request("retry", payload), resolveUnknown: (_execution, payload) => request("resolveUnknown", payload), reconcile: (_execution, payload) => request("reconcile", payload), cancel: (_execution, payload) => request("cancel", payload), redeemAdoption: (_execution, payload) => request("redeemAdoption", payload), recordAdoption: (_execution, payload) => request("recordAdoption", payload), recordFailure: (_execution, payload) => request("recordFailure", payload) };
  Object.defineProperties(provider, { dispose: { value: dispose }, toJSON: { value: () => ({ available: true }) } });
  return Object.freeze(provider);
}
function isRecordResult(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }

export class ProjectSessionLaunchRuntime {
  constructor({ filePath, provider, maxConcurrent = 2, maxConcurrentPerProject = 1, maxSessionsPerProject = 8, maxQueued = 64, clock = Date.now, disposeProvider = true, redactProjectBinding = false, fixedProjectBinding } = {}) {
    this.filePath = text(filePath, "filePath", 4096);
    this.provider = assertProvider(provider);
    this.disposeProvider = disposeProvider === true;
    this.redactProjectBinding = redactProjectBinding === true;
    this.fixedProjectBinding = fixedProjectBinding === undefined ? undefined : { canonicalProjectKey: text(fixedProjectBinding.canonicalProjectKey, "fixedProjectBinding.canonicalProjectKey", 128), workspacePath: text(fixedProjectBinding.workspacePath, "fixedProjectBinding.workspacePath", 4096) };
    if (this.fixedProjectBinding && !/^[a-f0-9]{64}$/u.test(this.fixedProjectBinding.canonicalProjectKey)) fail("fixed canonicalProjectKey is invalid");
    this.maxConcurrent = integer(maxConcurrent, "maxConcurrent", 1, 8);
    this.maxConcurrentPerProject = integer(maxConcurrentPerProject, "maxConcurrentPerProject", 1, this.maxConcurrent);
    this.maxSessionsPerProject = integer(maxSessionsPerProject, "maxSessionsPerProject", 2, 64);
    this.maxQueued = integer(maxQueued, "maxQueued", 1, 1024);
    this.clock = clock;
    this.document = undefined;
    this.writeChain = Promise.resolve();
    this.running = 0;
    this.runningByProject = new Map();
    this.executionByBatch = new Map();
    this.batchByRef = new Map();
    this.slotByRef = new Map();
    this.batchByProjectRequest = new Map();
    this.batchRefsByCallerRoot = new Map();
    this.queuedByProject = new Map();
    this.queuedCount = 0;
    this.outstandingCount = 0;
    this.projectOrder = [];
    this.lastStartedProject = undefined;
    this.activeRuns = new Set();
    this.closed = false;
    this.pumpScheduled = false;
    this.initPromise = undefined;
  }
  async init() {
    if (this.document) return this.safeState();
    if (this.initPromise) return this.initPromise;
    const pending = this.#initialize();
    this.initPromise = pending;
    try { return await pending; }
    catch (error) {
      if (this.initPromise === pending) { this.document = undefined; this.batchByRef.clear(); this.slotByRef.clear(); this.batchByProjectRequest.clear(); this.batchRefsByCallerRoot.clear(); this.queuedByProject.clear(); this.projectOrder.length = 0; this.queuedCount = 0; this.outstandingCount = 0; }
      throw error;
    } finally { if (this.initPromise === pending) this.initPromise = undefined; }
  }
  async #initialize() {
    if (this.document) return this.safeState();
    await mkdir(dirname(this.filePath), { recursive: true });
    try { this.document = validateDocument(JSON.parse(await readFile(this.filePath, "utf8"))); }
    catch (error) {
      if (error?.code !== "ENOENT") throw error;
      this.document = { version: VERSION, secret: randomBytes(32).toString("base64url"), batches: [] };
      await this.#persist();
    }
    let changed = false;
    for (const batch of this.document.batches) {
      if (typeof batch.rootSessionId === "string" && batch.rootSessionId.length > 0) {
        batch.callerStopRef = opaque(this.document.secret, "caller-stop", batch.rootSessionId);
        delete batch.rootSessionId;
        changed = true;
      }
      text(batch.callerStopRef, "batch.callerStopRef", 128);
      if (this.redactProjectBinding) {
        if (!this.fixedProjectBinding) fail("redacted launch ledger requires a fixed project binding", "PROJECT_SESSION_LAUNCH_STORE_INVALID");
        if (batch.canonicalProjectKey !== undefined || batch.workspacePath !== undefined) {
          if (batch.canonicalProjectKey !== this.fixedProjectBinding.canonicalProjectKey || batch.workspacePath !== this.fixedProjectBinding.workspacePath) fail("legacy launch ledger belongs to another canonical project", "PROJECT_SESSION_LAUNCH_PROJECT_MISMATCH");
          batch.laneBindingRef = this.#laneBindingRef(this.fixedProjectBinding.canonicalProjectKey); delete batch.canonicalProjectKey; delete batch.workspacePath; changed = true;
        }
        if (batch.laneBindingRef !== this.#laneBindingRef(this.fixedProjectBinding.canonicalProjectKey)) fail("launch ledger lane binding is invalid", "PROJECT_SESSION_LAUNCH_PROJECT_MISMATCH");
      }
      for (const slot of batch.slots) {
        if (["queued", "starting", "outcome_unknown"].includes(slot.state) && (typeof slot.slotActorRef !== "string" || typeof slot.taskRef !== "string")) { slot.state = "failed"; slot.errorCode = "PROJECT_SESSION_LAUNCH_RESERVATION_REQUIRED"; slot.updatedAt = timestamp(this.clock); changed = true; }
        else if (slot.state === "starting") { slot.state = "outcome_unknown"; slot.updatedAt = timestamp(this.clock); changed = true; }
      }
      batch.state = deriveBatchState(batch);
    }
    this.#rebuildIndexes();
    if (changed) await this.#persist();
    return this.safeState();
  }
  safeState() { return { available: this.provider !== undefined, closed: this.closed, queued: this.queuedCount, running: this.running, batchCount: this.batchByRef.size }; }
  validateSlots(totalSessions, slots) { return normalizeSlots(slots, integer(totalSessions, "totalSessions", 2, 64) - 1); }
  async preflight(execution, { totalSessions, projectBinding } = {}) {
    await this.init();
    if (this.closed) fail("session launch runtime is closed", "PROJECT_SESSION_LAUNCH_CLOSED");
    if (!this.provider) fail("Host project session launch capability is unavailable", "PROJECT_SESSION_LAUNCH_HOST_UNAVAILABLE");
    const requested = integer(totalSessions, "totalSessions", 2, 64), binding = this.#binding(projectBinding), project = await this.#resolveProject(execution, binding);
    const hostCapacity = integer(project.maxSessions ?? this.maxSessionsPerProject, "Host project binding.maxSessions", 2, 64), capacity = Math.min(hostCapacity, this.maxSessionsPerProject);
    if (requested > capacity) fail(`requested total exceeds capacity; maximum feasible total is ${capacity}`, "PROJECT_SESSION_LAUNCH_CAPACITY");
    return { binding, project };
  }
  async prepareStart(execution, input = {}) {
    const requestId = text(input.requestId, "requestId", 256), totalSessions = integer(input.totalSessions, "totalSessions", 2, 64), slots = normalizeSlots(input.slots, totalSessions - 1);
    const { binding, project } = await this.preflight(execution, { totalSessions, projectBinding: input.projectBinding });
    const projectRef = text(project.projectRef, "Host project binding.projectRef", 256), boardRef = text(project.boardRef, "Host project binding.boardRef", 256), rootSessionRef = text(project.rootSessionRef ?? project.seatRef, "Host project binding.seatRef", 256), projectTicket = text(project.projectTicket, "Host project binding.projectTicket", 512), inputDigest = digest({ totalSessions, slots });
    const existing = this.batchByProjectRequest.get(this.#projectRequestKey(projectRef, requestId));
    if (existing) {
      if (existing.inputDigest !== inputDigest) fail("requestId already belongs to different launch input", "PROJECT_SESSION_LAUNCH_IDEMPOTENCY_CONFLICT");
      if (existing.noHostEffects === true && existing.state === "reservation_failed") { for (const slot of existing.slots) if (slot.state === "reservation_failed") { slot.state = "reserving"; delete slot.errorCode; } existing.state = deriveBatchState(existing); existing.updatedAt = timestamp(this.clock); await this.#persist(); }
      return this.project(existing);
    }
    if (this.outstandingCount + slots.length > this.maxQueued) fail("session launch queue is full", "PROJECT_SESSION_LAUNCH_BACKPRESSURE");
    const createdAt = timestamp(this.clock), batchRef = opaque(this.document.secret, "batch", projectRef, requestId), batch = {
      batchRef, projectRef, boardRef, rootSessionRef, callerRootRef: binding.callerRootRef, callerStopRef: binding.callerStopRef, projectTicket, ...(this.redactProjectBinding ? { laneBindingRef: this.#laneBindingRef(binding.canonicalProjectKey) } : { canonicalProjectKey: binding.canonicalProjectKey, workspacePath: binding.workspacePath }), requestId, inputDigest, totalSessions, state: "reserving", noHostEffects: true, stopRequested: false, createdAt, updatedAt: createdAt,
      slots: slots.map((slot, index) => ({ ...slot, slotRef: opaque(this.document.secret, "slot", batchRef, index), operationRef: opaque(this.document.secret, "operation", batchRef, index), state: "reserving", attempt: 0, createdAt, updatedAt: createdAt })),
    };
    this.document.batches.push(batch); await this.#persist(); this.#indexBatch(batch); return this.project(batch);
  }
  async prepareAdoptions(execution, { batchRef, projectBinding } = {}) {
    await this.init();
    const batch = this.#batch(batchRef); await this.#assertBinding(execution, batch, this.#binding(projectBinding));
    if (batch.noHostEffects !== true) return { batchRef: batch.batchRef, prepared: [] };
    const prepared = [];
    for (const slot of batch.slots) {
      try {
        const result = record(await this.provider.reserveAdoption(execution, { canonicalProjectKey: this.#canonicalProjectKey(batch), projectRef: batch.projectRef, boardRef: batch.boardRef, projectTicket: batch.projectTicket, callerRootRef: batch.callerRootRef, batchRef: batch.batchRef, slotRef: slot.slotRef, operationRef: slot.operationRef }), "Host adoption reservation");
        if (result.projectRef !== batch.projectRef || result.operationRef !== slot.operationRef) fail("Host adoption reservation binding is invalid", "PROJECT_SESSION_LAUNCH_PROVIDER_MISMATCH");
        prepared.push({ slotRef: slot.slotRef, operationRef: slot.operationRef, adoptionCapability: text(result.adoptionCapability, "adoptionCapability", 512) });
      } catch (error) {
        slot.state = "reservation_failed"; slot.errorCode = typeof error?.code === "string" ? error.code : "PROJECT_SESSION_LAUNCH_RESERVATION_FAILED"; slot.updatedAt = timestamp(this.clock); batch.state = deriveBatchState(batch); batch.updatedAt = slot.updatedAt; await this.#persist(); throw error;
      }
    }
    return { batchRef: batch.batchRef, prepared };
  }
  async recoveryReservation(execution, { batchRef, projectBinding } = {}) {
    await this.init();
    const batch = this.#batch(batchRef); await this.#assertBinding(execution, batch, this.#binding(projectBinding));
    if (batch.slots.length !== 1) fail("root recovery launch must contain exactly one slot", "PROJECT_ROOT_RECOVERY_CONFLICT");
    const slot = batch.slots[0];
    return { batchRef: batch.batchRef, noHostEffects: batch.noHostEffects === true, state: batch.state, slotRef: slot.slotRef, operationRef: slot.operationRef, slotState: slot.state };
  }
  async recordReservationFailure(execution, { batchRef, reservations = [], failedIndex, errorCode, projectBinding } = {}) {
    await this.init();
    const batch = this.#batch(batchRef); await this.#assertBinding(execution, batch, this.#binding(projectBinding));
    if (batch.noHostEffects !== true) fail("activated launch batches cannot record reservation failure", "PROJECT_SESSION_LAUNCH_RESERVATION_INVALID");
    const completed = normalizeReservations(reservations, reservations.length);
    for (let index = 0; index < completed.length; index += 1) { const target = batch.slots[index], value = completed[index]; if (target.slotRef !== value.slotRef || target.operationRef !== value.operationRef) fail("reservation refs do not match prepared batch", "PROJECT_SESSION_LAUNCH_RESERVATION_INVALID"); Object.assign(target, { slotActorRef: value.slotActorRef, taskRef: value.taskRef, state: "reserved" }); delete target.errorCode; }
    const failed = integer(failedIndex, "failedIndex", 0, batch.slots.length - 1); batch.slots[failed].state = "reservation_failed"; batch.slots[failed].errorCode = text(errorCode ?? "PROJECT_SESSION_LAUNCH_RESERVATION_FAILED", "errorCode", 256); batch.slots[failed].updatedAt = timestamp(this.clock); batch.state = deriveBatchState(batch); batch.updatedAt = batch.slots[failed].updatedAt; await this.#persist(); return this.project(batch);
  }
  async activatePreparedBatch(execution, { batchRef, reservations, projectBinding } = {}) {
    await this.init();
    const batch = this.#batch(batchRef); await this.#assertBinding(execution, batch, this.#binding(projectBinding));
    if (batch.noHostEffects !== true) { this.executionByBatch.set(batch.batchRef, execution); this.#schedulePump(); return this.project(batch); }
    const completed = normalizeReservations(reservations, batch.slots.length);
    for (let index = 0; index < completed.length; index += 1) { const target = batch.slots[index], value = completed[index]; if (target.slotRef !== value.slotRef || target.operationRef !== value.operationRef) fail("reservation refs do not match prepared batch", "PROJECT_SESSION_LAUNCH_RESERVATION_INVALID"); Object.assign(target, { slotActorRef: value.slotActorRef, taskRef: value.taskRef, state: "queued" }); delete target.errorCode; }
    batch.noHostEffects = false; batch.state = "queued"; batch.updatedAt = timestamp(this.clock); await this.#persist();
    for (const slot of batch.slots) this.#enqueue(batch, slot); this.executionByBatch.set(batch.batchRef, execution); this.#schedulePump(); return this.project(batch);
  }
  async start(execution, input = {}) { return this.activatePreparedBatch(execution, input); }
  async retryFailedSlot(execution, { slotRef, projectBinding } = {}) {
    await this.init();
    const selected=this.slotByRef.get(text(slotRef,"slotRef",128));
    if(!selected) fail("launch slot not found","PROJECT_SESSION_LAUNCH_NOT_FOUND");
    const {batch,slot}=selected; await this.#assertBinding(execution,batch,this.#binding(projectBinding));
    if(slot.state==="ready" || slot.state==="starting" || slot.state==="queued") return this.project(batch);
    if(slot.state!=="failed") fail("only a Host-reconciled failed slot may retry","PROJECT_SESSION_LAUNCH_RETRY_FORBIDDEN");
    this.#setSlotState(slot,"starting"); slot.attempt+=1; delete slot.errorCode; slot.updatedAt=timestamp(this.clock); batch.state=deriveBatchState(batch); batch.updatedAt=slot.updatedAt; await this.#persist();
    try { const result=record(await this.provider.retry(execution,{canonicalProjectKey:this.#canonicalProjectKey(batch),projectRef:batch.projectRef,boardRef:batch.boardRef,projectTicket:batch.projectTicket,callerRootRef:batch.callerRootRef,batchRef:batch.batchRef,slotRef:slot.slotRef,operationRef:slot.operationRef}),"Host retry result"); if(result.projectRef!==batch.projectRef||result.operationRef!==slot.operationRef) fail("Host retry result binding is invalid","PROJECT_SESSION_LAUNCH_PROVIDER_MISMATCH"); this.#setSlotState(slot,result.state==="ready"?"ready":result.state==="failed"?"failed":"outcome_unknown"); slot.errorCode=typeof result.errorCode==="string"?result.errorCode:undefined; slot.hostRevision=result.revision; } catch(error) { this.#setSlotState(slot,error?.code==="HOST_SESSION_LAUNCH_OUTCOME_UNKNOWN"||error?.definitive!==true?"outcome_unknown":"failed"); slot.errorCode=typeof error?.code==="string"?error.code:"PROJECT_SESSION_LAUNCH_OUTCOME_UNKNOWN"; }
    slot.updatedAt=timestamp(this.clock); batch.state=deriveBatchState(batch); batch.updatedAt=slot.updatedAt; await this.#persist(); return this.project(batch);
  }
  async rootFailureEvidence(execution,{failureRef,projectBinding}={}) {
    await this.init(); const selected=this.slotByRef.get(text(failureRef,"failureRef",128)); if(!selected) fail("failed Host operation is unavailable","PROJECT_ROOT_RECOVERY_EVIDENCE_REQUIRED"); const {batch,slot}=selected; await this.#assertBinding(execution,batch,this.#binding(projectBinding)); if(slot.state!=="failed"||typeof slot.slotActorRef!=="string"||typeof slot.taskRef!=="string") fail("Host has no failed top-level root evidence","PROJECT_ROOT_RECOVERY_EVIDENCE_REQUIRED"); const beneficiaryActorRef=slot.adoptedActorRef ?? slot.slotActorRef; return Object.freeze({failedActorRef:beneficiaryActorRef,beneficiaryActorRef,initiatorAuthorized:true,taskRef:slot.taskRef,operationRef:slot.operationRef,batchRef:batch.batchRef,failureCode:slot.errorCode||"HOST_SESSION_LAUNCH_FAILED",failureEvidence:`Host operation ${slot.operationRef} is durably ${slot.state}`,role:slot.role,resources:[...slot.resources],task:slot.task});
  }
  async resolveUnknownSlot(execution,{slotRef,requestId,decision,expectedRevision,projectBinding}={}) {
    await this.init(); const selected=this.slotByRef.get(text(slotRef,"slotRef",128)); if(!selected) fail("launch slot not found","PROJECT_SESSION_LAUNCH_NOT_FOUND");
    const {batch,slot}=selected; await this.#assertBinding(execution,batch,this.#binding(projectBinding));
    const result=record(await this.provider.resolveUnknown(execution,{canonicalProjectKey:this.#canonicalProjectKey(batch),projectRef:batch.projectRef,boardRef:batch.boardRef,projectTicket:batch.projectTicket,callerRootRef:batch.callerRootRef,batchRef:batch.batchRef,slotRef:slot.slotRef,operationRef:slot.operationRef,requestId:text(requestId,"requestId",256),decision:text(decision,"decision",32),expectedRevision}),"Host reconciliation result");
    if(result.projectRef!==batch.projectRef||result.operationRef!==slot.operationRef) fail("Host reconciliation binding is invalid","PROJECT_SESSION_LAUNCH_PROVIDER_MISMATCH");
    this.#setSlotState(slot,result.state==="ready"?"ready":result.state==="failed"?"failed":"outcome_unknown"); slot.hostRevision=result.revision; slot.errorCode=typeof result.errorCode==="string"?result.errorCode:undefined; slot.updatedAt=timestamp(this.clock); batch.state=deriveBatchState(batch); batch.updatedAt=slot.updatedAt; await this.#persist(); return this.project(batch);
  }
  async status(execution, { batchRef, projectBinding } = {}) {
    await this.init();
    const batch = this.#batch(batchRef); await this.#assertBinding(execution, batch, this.#binding(projectBinding));
    this.#resumeQueuedBatch(batch, execution);
    for (const slot of batch.slots.filter((candidate) => candidate.state === "outcome_unknown")) await this.#reconcile(batch, slot, execution);
    return this.project(batch);
  }
  async slotStatus(execution,{slotRef,projectBinding}={}) {
    await this.init(); const selected=this.slotByRef.get(text(slotRef,"slotRef",128)); if(!selected) fail("launch slot not found","PROJECT_SESSION_LAUNCH_NOT_FOUND");
    const {batch,slot}=selected; await this.#assertBinding(execution,batch,this.#binding(projectBinding)); this.#resumeQueuedBatch(batch,execution); if(slot.state==="outcome_unknown") await this.#reconcile(batch,slot,execution); return this.project(batch);
  }
  async redeemAdoption(execution, { slotRef, projectBinding } = {}) {
    await this.init();
    if (!this.provider) fail("Host project session launch capability is unavailable", "PROJECT_SESSION_LAUNCH_HOST_UNAVAILABLE");
    const selected = this.slotByRef.get(text(slotRef, "slotRef", 128));
    if (!selected || selected.slot.state !== "ready") fail("reserved launch slot is unavailable for adoption", "PROJECT_SESSION_ADOPTION_FORBIDDEN");
    const binding = this.#binding(projectBinding), project = await this.#resolveProject(execution, binding), { batch, slot } = selected;
    if (!this.#matchesProjectBinding(batch, binding) || project.projectRef !== batch.projectRef || project.boardRef !== batch.boardRef) fail("reserved seat belongs to another canonical project", "PROJECT_SESSION_LAUNCH_PROJECT_MISMATCH");
    const result = record(await this.provider.redeemAdoption(execution, { canonicalProjectKey: binding.canonicalProjectKey, projectRef: project.projectRef, boardRef: project.boardRef, projectTicket: project.projectTicket, callerRootRef: binding.callerRootRef, batchRef: batch.batchRef, slotRef: slot.slotRef, operationRef: slot.operationRef }), "Host adoption redemption");
    if (result.projectRef !== project.projectRef || result.operationRef !== slot.operationRef) fail("Host adoption redemption binding is invalid", "PROJECT_SESSION_LAUNCH_PROVIDER_MISMATCH");
    return { projectRef: project.projectRef, slotActorRef: slot.slotActorRef, slotCapability: text(result.adoptionCapability, "adoptionCapability", 512) };
  }
  async recordAdoption(execution, { slotRef, adoptedActorRef, projectBinding } = {}) {
    await this.init();
    const selected=this.slotByRef.get(text(slotRef,"slotRef",128)); if(!selected) fail("launch slot not found","PROJECT_SESSION_LAUNCH_NOT_FOUND");
    const binding=this.#binding(projectBinding),project=await this.#resolveProject(execution,binding),{batch,slot}=selected;
    if(!this.#matchesProjectBinding(batch,binding)||project.projectRef!==batch.projectRef||project.boardRef!==batch.boardRef) fail("reserved seat belongs to another canonical project","PROJECT_SESSION_LAUNCH_PROJECT_MISMATCH");
    const actor=text(adoptedActorRef,"adoptedActorRef",256),result=record(await this.provider.recordAdoption(execution,{canonicalProjectKey:binding.canonicalProjectKey,projectRef:project.projectRef,boardRef:project.boardRef,projectTicket:project.projectTicket,callerRootRef:binding.callerRootRef,batchRef:batch.batchRef,slotRef:slot.slotRef,operationRef:slot.operationRef,adoptedActorRef:actor}),"Host adoption record");
    if(result.projectRef!==project.projectRef||result.operationRef!==slot.operationRef) fail("Host adoption record binding is invalid","PROJECT_SESSION_LAUNCH_PROVIDER_MISMATCH");
    if(slot.adoptedActorRef!==undefined&&slot.adoptedActorRef!==actor) fail("launch slot adoption binding changed","PROJECT_SESSION_ADOPTION_FORBIDDEN");
    slot.adoptedActorRef=actor; slot.updatedAt=timestamp(this.clock); batch.updatedAt=slot.updatedAt; await this.#persist(); return {recorded:true};
  }
  async recordAdoptedActorFailure(execution,{adoptedActorRef,projectBinding}={}) {
    await this.init(); const actor=text(adoptedActorRef,"adoptedActorRef",256),binding=this.#binding(projectBinding),project=await this.#resolveProject(execution,binding);
    const matches=[]; for(const batch of this.document.batches) if(this.#matchesProjectBinding(batch,binding)&&batch.projectRef===project.projectRef&&batch.boardRef===project.boardRef) for(const slot of batch.slots) if(slot.adoptedActorRef===actor) matches.push({batch,slot});
    if(matches.length!==1) fail(matches.length===0?"adopted root launch binding is unavailable":"adopted root launch binding is ambiguous","PROJECT_ROOT_RECOVERY_EVIDENCE_REQUIRED");
    const {batch,slot}=matches[0]; if(slot.state==="failed") return this.project(batch); if(slot.state!=="ready") fail("adopted root lifecycle is not recoverable","PROJECT_ROOT_RECOVERY_EVIDENCE_REQUIRED");
    const result=record(await this.provider.recordFailure(execution,{canonicalProjectKey:binding.canonicalProjectKey,projectRef:project.projectRef,boardRef:project.boardRef,projectTicket:project.projectTicket,callerRootRef:binding.callerRootRef,batchRef:batch.batchRef,slotRef:slot.slotRef,operationRef:slot.operationRef}),"Host lifecycle failure record");
    if(result.projectRef!==project.projectRef||result.operationRef!==slot.operationRef||result.state!=="failed") fail("Host lifecycle failure binding is invalid","PROJECT_SESSION_LAUNCH_PROVIDER_MISMATCH");
    this.#setSlotState(slot,"failed");slot.errorCode=result.errorCode||"HOST_SESSION_LIFECYCLE_FAILED";slot.hostRevision=result.revision;slot.updatedAt=timestamp(this.clock);batch.state=deriveBatchState(batch);batch.updatedAt=slot.updatedAt;await this.#persist();return this.project(batch);
  }
  async stop(execution, { batchRef, projectBinding } = {}) {
    await this.init();
    const batch = this.#batch(batchRef); await this.#assertBinding(execution, batch, this.#binding(projectBinding));
    batch.stopRequested = true;
    if (batch.noHostEffects === true) for (const slot of batch.slots) if (!TERMINAL.has(slot.state)) { this.#setSlotState(slot, "cancelled"); slot.updatedAt = timestamp(this.clock); }
    else for (const slot of batch.slots) if (slot.state === "queued") this.#cancelQueuedSlot(slot);
    batch.state = deriveBatchState(batch); batch.updatedAt = timestamp(this.clock); await this.#persist();
    for (const slot of batch.slots.filter((candidate) => candidate.state === "starting" || candidate.state === "outcome_unknown")) {
      try { const result = await this.provider.cancel(execution, { canonicalProjectKey: this.#canonicalProjectKey(batch), projectRef: batch.projectRef, boardRef: batch.boardRef, projectTicket: batch.projectTicket, callerRootRef: batch.callerRootRef, batchRef: batch.batchRef, slotRef: slot.slotRef, operationRef: slot.operationRef }); if (result?.cancelled === true) this.#setSlotState(slot, "cancelled"); }
      catch { this.#setSlotState(slot, "outcome_unknown"); }
      slot.updatedAt = timestamp(this.clock);
    }
    batch.state = deriveBatchState(batch); batch.updatedAt = timestamp(this.clock); await this.#persist(); return this.project(batch);
  }
  async stopForRoot(rootSessionId) {
    await this.init();
    const callerStopRef = opaque(this.document.secret, "caller-stop", text(rootSessionId, "rootSessionId", 256));
    const targets = [...(this.batchRefsByCallerRoot.get(callerStopRef) ?? [])].map((batchRef) => this.batchByRef.get(batchRef)).filter((batch) => batch !== undefined && !["ready", "failed", "stopped"].includes(batch.state));
    for (const batch of targets) { batch.stopRequested = true; for (const slot of batch.slots) { if (batch.noHostEffects === true && !TERMINAL.has(slot.state)) { this.#setSlotState(slot, "cancelled"); slot.updatedAt = timestamp(this.clock); } else if (slot.state === "queued") this.#cancelQueuedSlot(slot); } batch.state = deriveBatchState(batch); batch.updatedAt = timestamp(this.clock); }
    if (targets.length) await this.#persist();
  }
  project(batch) { return { batchRef: batch.batchRef, boardRef: batch.boardRef, totalSessions: batch.totalSessions, total: batch.slots.length, reservedCount: batch.slots.filter((slot) => typeof slot.slotActorRef === "string" && typeof slot.taskRef === "string").length, noHostEffects: batch.noHostEffects === true, createdSessionCount: batch.slots.filter((slot) => slot.state === "ready").length, state: batch.state, slots: batch.slots.map(publicSlot) }; }
  async close() { this.closed = true; await Promise.allSettled([...this.activeRuns]); this.executionByBatch.clear(); this.batchByRef.clear(); this.slotByRef.clear(); this.batchByProjectRequest.clear(); this.batchRefsByCallerRoot.clear(); this.queuedByProject.clear(); await this.writeChain; if (this.disposeProvider) this.provider?.dispose?.(); }
  #binding(value) {
    const binding = record(value, "Host internal project binding");
    const canonicalProjectKey = text(binding.canonicalProjectKey, "canonicalProjectKey", 128);
    if (!/^[a-f0-9]{64}$/u.test(canonicalProjectKey)) fail("canonicalProjectKey is invalid");
    const workspacePath = text(binding.workspacePath, "workspacePath", 4096), callerRootId = text(binding.callerRootId, "callerRootId", 256);
    if (this.fixedProjectBinding && (canonicalProjectKey !== this.fixedProjectBinding.canonicalProjectKey || workspacePath !== this.fixedProjectBinding.workspacePath)) fail("project binding belongs to another launch lane", "PROJECT_SESSION_LAUNCH_PROJECT_MISMATCH");
    let callerRootRef;
    try { callerRootRef = this.provider.callerRootRef(canonicalProjectKey, callerRootId); } catch { throw providerError(); }
    if (typeof callerRootRef !== "string" || !/^[a-f0-9]{64}$/u.test(callerRootRef)) throw providerError();
    const callerStopRef = opaque(this.document.secret, "caller-stop", callerRootId);
    return { canonicalProjectKey, workspacePath, callerRootRef, callerStopRef };
  }
  async #resolveProject(execution, binding) { return record(await this.provider.resolveProject(execution, { canonicalProjectKey: binding.canonicalProjectKey, workspacePath: binding.workspacePath, callerRootRef: binding.callerRootRef }), "Host project binding"); }
  #laneBindingRef(canonicalProjectKey) { return opaque(this.document.secret, "lane-binding", canonicalProjectKey); }
  #canonicalProjectKey(batch) { return this.fixedProjectBinding?.canonicalProjectKey ?? batch.canonicalProjectKey; }
  #matchesProjectBinding(batch, binding) { return this.redactProjectBinding ? batch.laneBindingRef === this.#laneBindingRef(binding.canonicalProjectKey) && binding.workspacePath === this.fixedProjectBinding?.workspacePath : binding.canonicalProjectKey === batch.canonicalProjectKey && binding.workspacePath === batch.workspacePath; }
  #projectRequestKey(projectRef, requestId) { return `${projectRef}\0${requestId}`; }
  #batch(batchRef) { const selected = this.batchByRef.get(text(batchRef, "batchRef", 128)); if (!selected) fail("launch batch not found", "PROJECT_SESSION_LAUNCH_NOT_FOUND"); return selected; }
  #noteProject(projectRef) { if (!this.projectOrder.includes(projectRef)) this.projectOrder.push(projectRef); }
  #indexBatch(batch) {
    this.batchByRef.set(batch.batchRef, batch);
    this.batchByProjectRequest.set(this.#projectRequestKey(batch.projectRef, batch.requestId), batch);
    const roots = this.batchRefsByCallerRoot.get(batch.callerStopRef) ?? new Set(); roots.add(batch.batchRef); this.batchRefsByCallerRoot.set(batch.callerStopRef, roots);
    for (const slot of batch.slots) {
      this.slotByRef.set(slot.slotRef, { batch, slot });
      if (!TERMINAL.has(slot.state)) this.outstandingCount += 1;
      if (slot.state === "queued" && !batch.stopRequested) this.#enqueue(batch, slot);
    }
  }
  #rebuildIndexes() {
    this.batchByRef.clear(); this.slotByRef.clear(); this.batchByProjectRequest.clear(); this.batchRefsByCallerRoot.clear(); this.queuedByProject.clear(); this.projectOrder.length = 0; this.queuedCount = 0; this.outstandingCount = 0;
    for (const batch of this.document.batches) this.#indexBatch(batch);
  }
  #enqueue(batch, slot) {
    const queue = this.queuedByProject.get(batch.projectRef) ?? [];
    queue.push({ batchRef: batch.batchRef, slotRef: slot.slotRef }); this.queuedByProject.set(batch.projectRef, queue); this.queuedCount += 1; this.#noteProject(batch.projectRef);
  }
  #setSlotState(slot, state) { const wasOutstanding = !TERMINAL.has(slot.state), isOutstanding = !TERMINAL.has(state); slot.state = state; if (wasOutstanding && !isOutstanding) this.outstandingCount = Math.max(0, this.outstandingCount - 1); else if (!wasOutstanding && isOutstanding) this.outstandingCount += 1; }
  #cancelQueuedSlot(slot) { if (slot.state !== "queued") return; this.#setSlotState(slot, "cancelled"); slot.updatedAt = timestamp(this.clock); this.queuedCount = Math.max(0, this.queuedCount - 1); }
  #takeQueued(projectRef) {
    const queue = this.queuedByProject.get(projectRef);
    if (!queue?.length) return undefined;
    for (let index = 0; index < queue.length; index += 1) {
      const ref = queue[index], batch = this.batchByRef.get(ref.batchRef), slot = batch?.slots.find((candidate) => candidate.slotRef === ref.slotRef);
      if (batch === undefined || slot?.state !== "queued" || batch.stopRequested) { queue.splice(index, 1); index -= 1; continue; }
      if (!this.executionByBatch.has(batch.batchRef)) continue;
      queue.splice(index, 1); this.queuedCount = Math.max(0, this.queuedCount - 1); return { batch, slot };
    }
    if (queue.length === 0) this.queuedByProject.delete(projectRef);
    return undefined;
  }
  #pruneProjects() { this.projectOrder = this.projectOrder.filter((projectRef) => (this.queuedByProject.get(projectRef)?.length ?? 0) > 0); }
  async #assertBinding(execution, batch, binding) { if (!this.provider) fail("Host project session launch capability is unavailable", "PROJECT_SESSION_LAUNCH_HOST_UNAVAILABLE"); const current = await this.#resolveProject(execution, binding), seatRef = current.rootSessionRef ?? current.seatRef; if (binding.callerRootRef !== batch.callerRootRef || binding.callerStopRef !== batch.callerStopRef || !this.#matchesProjectBinding(batch, binding) || current.projectRef !== batch.projectRef || current.boardRef !== batch.boardRef || seatRef !== batch.rootSessionRef || current.projectTicket !== batch.projectTicket) fail("launch batch belongs to another canonical project or root", "PROJECT_SESSION_LAUNCH_PROJECT_MISMATCH"); }
  #resumeQueuedBatch(batch, execution) { if (batch.stopRequested || !batch.slots.some((slot) => slot.state === "queued")) return; this.executionByBatch.set(batch.batchRef, execution); this.#schedulePump(); }
  #schedulePump() { if (this.closed || this.pumpScheduled) return; this.pumpScheduled = true; queueMicrotask(() => { this.pumpScheduled = false; void this.#pump(); }); }
  async #pump() {
    while (!this.closed && this.running < this.maxConcurrent) {
      this.#pruneProjects();
      if (this.projectOrder.length === 0) return;
      let selected;
      const previousIndex = this.projectOrder.indexOf(this.lastStartedProject);
      const startIndex = previousIndex < 0 ? 0 : (previousIndex + 1) % this.projectOrder.length;
      for (let offset = 0; offset < this.projectOrder.length; offset += 1) {
        const index = (startIndex + offset) % this.projectOrder.length, projectRef = this.projectOrder[index];
        if ((this.runningByProject.get(projectRef) ?? 0) >= this.maxConcurrentPerProject) continue;
        selected = this.#takeQueued(projectRef);
        if (selected) { this.lastStartedProject = projectRef; break; }
      }
      if (!selected) return;
      this.running += 1; this.runningByProject.set(selected.batch.projectRef, (this.runningByProject.get(selected.batch.projectRef) ?? 0) + 1);
      const run = this.#run(selected.batch, selected.slot).finally(() => { this.activeRuns.delete(run); this.running -= 1; const count = (this.runningByProject.get(selected.batch.projectRef) ?? 1) - 1; if (count > 0) this.runningByProject.set(selected.batch.projectRef, count); else this.runningByProject.delete(selected.batch.projectRef); this.#schedulePump(); });
      this.activeRuns.add(run);
    }
  }
  async #run(batch, slot) {
    const execution = this.executionByBatch.get(batch.batchRef); if (!execution || batch.stopRequested) return;
    this.#setSlotState(slot, "starting"); slot.attempt += 1; slot.updatedAt = timestamp(this.clock); batch.state = deriveBatchState(batch); batch.updatedAt = slot.updatedAt; await this.#persist();
    try {
      const hostTask = boundedUtf8(slot.task, 1_500, 4 * 1024);
      const initialization = `Project board rules: adopt reserved slot ${slot.slotRef} through project_collaboration adopt_slot before work. Duty: ${slot.role}. Resource scope: ${slot.resources.join(", ")}. Initial task: ${hostTask}. No additional project context is included. Read the current project board only through safe root tools; modify only the resources named above; explicitly post root-level status/evidence. Your private Agent Team is separate, and member completion never updates the project board.`;
      if (Buffer.byteLength(initialization, "utf8") > 8 * 1024) fail("launch initialization exceeds the bounded 8 KiB Host prompt", "PROJECT_SESSION_LAUNCH_INVALID");
      const result = record(await this.provider.launch(execution, { canonicalProjectKey: this.#canonicalProjectKey(batch), projectRef: batch.projectRef, boardRef: batch.boardRef, projectTicket: batch.projectTicket, callerRootRef: batch.callerRootRef, batchRef: batch.batchRef, slotRef: slot.slotRef, operationRef: slot.operationRef, title: slot.title, role: slot.role, resources: [...slot.resources], task: hostTask, initialization }), "Host launch result");
      if (result.projectRef !== batch.projectRef || result.operationRef !== slot.operationRef) fail("Host launch result binding is invalid", "PROJECT_SESSION_LAUNCH_PROVIDER_MISMATCH");
      this.#setSlotState(slot, result.state === "ready" ? "ready" : result.state === "failed" ? "failed" : "outcome_unknown");
      slot.errorCode = typeof result.errorCode === "string" ? result.errorCode : undefined; slot.hostRevision = result.revision;
    } catch (error) {
      this.#setSlotState(slot, error?.definitive === true ? "failed" : "outcome_unknown");
      slot.errorCode = typeof error?.code === "string" ? error.code : "PROJECT_SESSION_LAUNCH_OUTCOME_UNKNOWN";
    }
    slot.updatedAt = timestamp(this.clock); batch.state = deriveBatchState(batch); batch.updatedAt = slot.updatedAt; await this.#persist();
  }
  async #reconcile(batch, slot, execution) {
    try {
      const result = record(await this.provider.reconcile(execution, { canonicalProjectKey: this.#canonicalProjectKey(batch), projectRef: batch.projectRef, boardRef: batch.boardRef, projectTicket: batch.projectTicket, callerRootRef: batch.callerRootRef, batchRef: batch.batchRef, slotRef: slot.slotRef, operationRef: slot.operationRef }), "Host reconciliation result");
      if (result.projectRef !== batch.projectRef || result.operationRef !== slot.operationRef) fail("Host reconciliation binding is invalid", "PROJECT_SESSION_LAUNCH_PROVIDER_MISMATCH");
      if (["ready", "failed", "cancelled"].includes(result.state)) this.#setSlotState(slot, result.state);
      slot.errorCode = typeof result.errorCode === "string" ? result.errorCode : slot.errorCode; slot.hostRevision = result.revision;
    } catch { this.#setSlotState(slot, "outcome_unknown"); }
    slot.updatedAt = timestamp(this.clock); batch.state = deriveBatchState(batch); batch.updatedAt = slot.updatedAt; await this.#persist();
  }
  async #persist() {
    if (this.document.batches.some((batch) => Object.hasOwn(batch, "rootSessionId"))) fail("raw root session identity must not be persisted", "PROJECT_SESSION_LAUNCH_STORE_INVALID");
    if (this.redactProjectBinding && this.document.batches.some((batch) => Object.hasOwn(batch, "canonicalProjectKey") || Object.hasOwn(batch, "workspacePath"))) fail("raw canonical project binding must not be persisted", "PROJECT_SESSION_LAUNCH_STORE_INVALID");
    const snapshot = JSON.stringify(validateDocument(clone(this.document)));
    this.writeChain = this.writeChain.then(async () => {
      const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`, handle = await open(temporary, "wx", 0o600);
      try { await handle.writeFile(snapshot, "utf8"); await handle.sync(); } finally { await handle.close(); }
      try { await replaceFile(temporary, this.filePath); } finally { await rm(temporary, { force: true }).catch(() => undefined); }
    });
    return this.writeChain;
  }
}

/** Per-canonical-project launch ledgers. The Host provider remains a single shared
 * admission plane, but no project shares a plugin file lock, write chain or queue. */
export class ProjectSessionLaunchRegistry {
  constructor({ rootPath, legacyFilePath, provider, ...runtimeOptions } = {}) {
    this.rootPath = text(rootPath, "rootPath", 4096);
    this.legacyFilePath = legacyFilePath === undefined ? undefined : text(legacyFilePath, "legacyFilePath", 4096);
    this.provider = assertProvider(provider);
    this.runtimeOptions = runtimeOptions;
    this.runtimes = new Map();
    this.legacyRuntime = undefined;
    this.closed = false;
  }
  async init() {
    await mkdir(this.rootPath, { recursive: true });
    if (this.legacyFilePath && await stat(this.legacyFilePath).then(() => true, (error) => error?.code === "ENOENT" ? false : Promise.reject(error))) {
      this.legacyRuntime = new ProjectSessionLaunchRuntime({ ...this.runtimeOptions, filePath: this.legacyFilePath, provider: this.provider, disposeProvider: false });
      await this.legacyRuntime.init();
    }
    return this.safeState();
  }
  safeState() { return { available: this.provider !== undefined, closed: this.closed, laneCount: this.runtimes.size, queued: [...this.runtimes.values()].reduce((sum, entry) => sum + entry.runtime.safeState().queued, 0), running: [...this.runtimes.values()].reduce((sum, entry) => sum + entry.runtime.safeState().running, 0) }; }
  validateSlots(totalSessions, slots) { return normalizeSlots(slots, integer(totalSessions, "totalSessions", 2, 64) - 1); }
  async preflight(execution, input = {}) { return (await this.#lane(input.projectBinding)).preflight(execution, input); }
  async prepareStart(execution, input = {}) { return (await this.#lane(input.projectBinding)).prepareStart(execution, input); }
  async prepareAdoptions(execution, input = {}) { return (await this.#lane(input.projectBinding)).prepareAdoptions(execution, input); }
  async recoveryReservation(execution,input={}) { return this.#withLegacyFallback("recoveryReservation",execution,input,"PROJECT_SESSION_LAUNCH_NOT_FOUND"); }
  async recordAdoption(execution,input={}) { return this.#withLegacyFallback("recordAdoption",execution,input,"PROJECT_SESSION_LAUNCH_NOT_FOUND"); }
  async recordAdoptedActorFailure(execution,input={}) { return this.#withLegacyFallback("recordAdoptedActorFailure",execution,input,"PROJECT_ROOT_RECOVERY_EVIDENCE_REQUIRED"); }
  async slotStatus(execution,input={}) { return this.#withLegacyFallback("slotStatus",execution,input,"PROJECT_SESSION_LAUNCH_NOT_FOUND"); }
  async recordReservationFailure(execution, input = {}) { return (await this.#lane(input.projectBinding)).recordReservationFailure(execution, input); }
  async activatePreparedBatch(execution, input = {}) { return (await this.#lane(input.projectBinding)).activatePreparedBatch(execution, input); }
  async start(execution, input = {}) { return (await this.#lane(input.projectBinding)).start(execution, input); }
  async retryFailedSlot(execution,input={}) { return this.#withLegacyFallback("retryFailedSlot",execution,input,"PROJECT_SESSION_LAUNCH_NOT_FOUND"); }
  async status(execution, input = {}) { return this.#withLegacyFallback("status", execution, input, "PROJECT_SESSION_LAUNCH_NOT_FOUND"); }
  async redeemAdoption(execution, input = {}) { return this.#withLegacyFallback("redeemAdoption", execution, input, "PROJECT_SESSION_ADOPTION_FORBIDDEN"); }
  async stop(execution, input = {}) { return this.#withLegacyFallback("stop", execution, input, "PROJECT_SESSION_LAUNCH_NOT_FOUND"); }
  async stopForRoot(rootSessionId, projectBinding) {
    if (projectBinding) { const runtime = await this.#lane(projectBinding); await Promise.all([runtime.stopForRoot(rootSessionId), this.legacyRuntime?.stopForRoot(rootSessionId)]); return; }
    await Promise.all([...this.runtimes.values()].map((entry) => entry.ready.then((runtime) => runtime.stopForRoot(rootSessionId))).concat(this.legacyRuntime ? [this.legacyRuntime.stopForRoot(rootSessionId)] : []));
  }
  async close() { if (this.closed) return; this.closed = true; await Promise.allSettled([...this.runtimes.values()].map((entry) => entry.ready.catch(() => entry.runtime).then((runtime) => runtime.close())).concat(this.legacyRuntime ? [this.legacyRuntime.close()] : [])); this.runtimes.clear(); this.legacyRuntime = undefined; this.provider?.dispose?.(); }
  async #withLegacyFallback(method, execution, input, fallbackCode) {
    const runtime = await this.#lane(input.projectBinding);
    try { return await runtime[method](execution, input); }
    catch (error) {
      if (!this.legacyRuntime || error?.code !== fallbackCode) throw error;
      return this.legacyRuntime[method](execution, input);
    }
  }
  #laneReference(projectBinding) {
    const binding = record(projectBinding, "Host internal project binding"), canonicalProjectKey = text(binding.canonicalProjectKey, "canonicalProjectKey", 128);
    if (!/^[a-f0-9]{64}$/u.test(canonicalProjectKey) || !this.provider) fail("Host project session launch capability is unavailable", "PROJECT_SESSION_LAUNCH_HOST_UNAVAILABLE");
    const laneRef = this.provider.callerRootRef(canonicalProjectKey, "project-session-launch-lane");
    if (typeof laneRef !== "string" || !/^[a-f0-9]{64}$/u.test(laneRef)) throw providerError();
    return laneRef;
  }
  async #lane(projectBinding) {
    if (this.closed) fail("session launch registry is closed", "PROJECT_SESSION_LAUNCH_CLOSED");
    const binding = record(projectBinding, "Host internal project binding"), canonicalProjectKey = text(binding.canonicalProjectKey, "canonicalProjectKey", 128), workspacePath = text(binding.workspacePath, "workspacePath", 4096);
    const laneRef = this.#laneReference(binding);
    let entry = this.runtimes.get(laneRef);
    if (!entry) {
      const filePath = join(this.rootPath, `lane_${laneRef}`, "launch.json");
      const runtime = new ProjectSessionLaunchRuntime({ ...this.runtimeOptions, filePath, provider: this.provider, disposeProvider: false, redactProjectBinding: true, fixedProjectBinding: { canonicalProjectKey, workspacePath } });
      entry = { runtime, ready: undefined };
      entry.ready = runtime.init().then(() => runtime);
      this.runtimes.set(laneRef, entry);
      entry.ready.catch(async () => { if (this.runtimes.get(laneRef) === entry) this.runtimes.delete(laneRef); await runtime.close().catch(() => undefined); });
    }
    return entry.ready;
  }
}

export function resolveProjectSessionLaunchProvider(ctx, options = {}) {
  const desktop = consumeDesktopProjectSessionLaunchCapability(options);
  if (desktop) return desktop;
  let value;
  try { value = typeof ctx?.get === "function" ? ctx.get("projectSessionLaunch") : undefined; } catch { return undefined; }
  return assertProvider(value);
}

export { CALLER_SALT_ENV, ENDPOINT_ENV, TOKEN_ENV, consumeDesktopProjectSessionLaunchCapability };
