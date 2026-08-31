import { createHmac } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

const VERSION = 1;
const CANONICAL_KEY = /^[a-f0-9]{64}$/u;
const LANE_DOMAIN = "dsh-agent-teams/canonical-project-lane/v1";
const PROJECT_DOMAIN = "dsh-agent-teams/canonical-project-ref/v1";
const KEY_DOMAIN = "dsh-agent-teams/canonical-project-task-key/v1";
const SQLITE_BUSY_TIMEOUT_MS = 2_000;

function failure(message, code = "PROJECT_ENTRY_TASK_CONTEXT_INVALID") { const error = new Error(message); error.code = code; throw error; }
function canonical(value) { if (typeof value !== "string" || !CANONICAL_KEY.test(value)) failure("Host canonical project key is invalid"); return value; }
function exists(file) { return stat(file).then(() => true, error => error?.code === "ENOENT" ? false : Promise.reject(error)); }
function hmac(key, domain, ...parts) { return createHmac("sha256", key).update(domain).update("\0").update(JSON.stringify(parts)).digest("base64url"); }
async function atomicJson(file, value) { await mkdir(dirname(file), { recursive: true }); const temporary = `${file}.${process.pid}.${Date.now()}.tmp`; await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 }); await rename(temporary, file); }
async function removeWithRetry(file) {
  const deadline = Date.now() + SQLITE_BUSY_TIMEOUT_MS;
  for (;;) {
    try { await rm(file, { force: true }); return; }
    catch (error) { if (!new Set(["EBUSY", "EPERM", "EACCES"]).has(error?.code) || Date.now() >= deadline) throw error; await new Promise(resolve => setTimeout(resolve, 25)); }
  }
}
async function removeIncompleteDatabase(file) { for (const candidate of [file, `${file}-wal`, `${file}-shm`]) await removeWithRetry(candidate); }
function openLegacy(file) {
  const database = new DatabaseSync(file, { readOnly: true });
  database.exec(`PRAGMA busy_timeout=${SQLITE_BUSY_TIMEOUT_MS}`);
  return database;
}
function legacyHasBoard(file) {
  const database = openLegacy(file);
  try {
    const table = database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='project_collaboration_boards'").get();
    return table !== undefined && Number(database.prepare("SELECT COUNT(*) AS total FROM project_collaboration_boards").get().total) > 0;
  } finally { database.close(); }
}
async function snapshotLegacyDatabase(source, temporary, destination) {
  await rm(temporary, { force: true });
  const database = openLegacy(source);
  try { await backup(database, temporary); }
  catch (error) {
    if (String(error?.message ?? "").toLowerCase().includes("busy") || String(error?.message ?? "").toLowerCase().includes("locked")) failure("legacy project task database is busy; retry initialization", "PROJECT_ENTRY_LEGACY_MIGRATION_BUSY");
    throw error;
  } finally { database.close(); }
  await chmod(temporary, 0o600).catch(() => undefined);
  await rename(temporary, destination);
}

/**
 * Host-only canonical-project router. It deliberately wraps one ProjectEntryService:
 * the one-time OS secret capability and remote Project Entry authority remain singletons,
 * while local task/collaboration stores receive independent opaque refs, keys and files.
 */
export class ProjectEntryRegistry {
  constructor({ projectEntry, dshHome, legacyEvidenceProvider } = {}) {
    if (!projectEntry || typeof projectEntry.localProjectTaskContext !== "function") throw new TypeError("projectEntry is required");
    if (typeof dshHome !== "string" || dshHome.length === 0) throw new TypeError("dshHome is required");
    this.projectEntry = projectEntry;
    this.requiresCanonicalProjectKey = true;
    this.storages = join(dshHome, "storages");
    this.lanesRoot = join(this.storages, "project_lanes");
    this.markerPath = join(this.lanesRoot, "legacy-task-binding.json");
    this.legacyPath = join(this.storages, "agent_project_tasks.sqlite");
    this.legacyEvidenceProvider = typeof legacyEvidenceProvider === "function" ? legacyEvidenceProvider : async () => undefined;
    this.laneModes = new Map();
    this.legacyBindingLaneRef = undefined;
    this.noLegacyBinding = false;
    this.migrationChain = Promise.resolve();
    this.closed = false;
  }

  async localProjectCollaborationContext({ canonicalProjectKey } = {}) { return this.localProjectTaskContext({ canonicalProjectKey }); }
  async bindLegacyProjectCollaborationContext({ canonicalProjectKey } = {}) { return this.bindLegacyProjectTaskContext({ canonicalProjectKey }); }
  async localProjectTaskContext({ canonicalProjectKey } = {}) { return this.#localProjectTaskContext({ canonicalProjectKey, bindLegacy: false }); }
  async bindLegacyProjectTaskContext({ canonicalProjectKey } = {}) { return this.#localProjectTaskContext({ canonicalProjectKey, bindLegacy: true }); }

  async #localProjectTaskContext({ canonicalProjectKey, bindLegacy }) {
    if (this.closed) failure("canonical project registry is closed");
    const projectKey = canonical(canonicalProjectKey), base = await this.projectEntry.localProjectTaskContext();
    let authorityKey;
    try {
      base.actorResolver(base.execution, base.projectRef);
      authorityKey = base.keyProvider(base.projectRef);
      const laneRef = `lane_${hmac(authorityKey, LANE_DOMAIN, projectKey)}`;
      const databasePath = join(this.lanesRoot, laneRef, "tasks.sqlite");
      const legacyBound = await this.#ensureLegacyBinding({ laneRef, databasePath, bindLegacy, projectKey });
      const projectRef = legacyBound ? base.projectRef : `project_${hmac(authorityKey, PROJECT_DOMAIN, laneRef)}`;
      const laneKey = legacyBound ? Buffer.from(authorityKey) : createHmac("sha256", authorityKey).update(KEY_DOMAIN).update("\0").update(laneRef).update("\0").update(projectRef).digest();
      let disposed = false;
      const execution = Object.freeze(Object.create(null));
      const assertCurrent = (candidate, requestedProjectRef) => {
        if (disposed || candidate !== execution || requestedProjectRef !== projectRef) failure("canonical project task context is stale or belongs to another lane");
        base.actorResolver(base.execution, base.projectRef);
      };
      const baseActor = base.actorResolver(base.execution, base.projectRef);
      const actor = Object.freeze({ projectRef, actorRef: `collaborator_${hmac(laneKey, "dsh-agent-teams/canonical-project-actor/v1", baseActor.actorRef)}`, kind: baseActor.kind, role: baseActor.role });
      const dispose = () => { if (disposed) return false; disposed = true; laneKey.fill(0); base.dispose(); return true; };
      const context = Object.create(null);
      Object.defineProperties(context, {
        projectRef: { value: projectRef, enumerable: false }, databasePath: { value: databasePath, enumerable: false }, laneRef: { value: laneRef, enumerable: false }, execution: { value: execution, enumerable: false },
        actorResolver: { value: (candidate, requestedProjectRef) => { assertCurrent(candidate, requestedProjectRef); return actor; }, enumerable: false },
        keyProvider: { value: requestedProjectRef => { assertCurrent(execution, requestedProjectRef); return Buffer.from(laneKey); }, enumerable: false },
        dispose: { value: dispose, enumerable: false },
      });
      return Object.freeze(context);
    } catch (error) { base.dispose(); throw error; }
    finally { authorityKey?.fill(0); }
  }

  async #ensureLegacyBinding({ laneRef, databasePath, bindLegacy, projectKey }) {
    if (this.legacyBindingLaneRef !== undefined && this.legacyBindingLaneRef !== laneRef) {
      if (bindLegacy === true) failure("legacy project task database is already bound to another canonical project", "PROJECT_ENTRY_LEGACY_BINDING_CONFLICT");
      this.laneModes.set(laneRef, Promise.resolve(false));
      return false;
    }
    const known = this.laneModes.get(laneRef);
    if (known) return known;
    if (this.noLegacyBinding) { this.laneModes.set(laneRef, Promise.resolve(false)); return false; }
    // One process owns this registry. A bounded in-memory chain is sufficient for
    // the one-time legacy decision/copy and cannot leave a crash-persistent lock.
    // Once a lane mode is cached, its hot path never enters this chain.
    const pending = this.migrationChain.catch(() => undefined).then(async () => {
      if (this.legacyBindingLaneRef !== undefined && this.legacyBindingLaneRef !== laneRef) {
        if (bindLegacy === true) failure("legacy project task database is already bound to another canonical project", "PROJECT_ENTRY_LEGACY_BINDING_CONFLICT");
        return false;
      }
      await mkdir(dirname(databasePath), { recursive: true });
      if (!(await exists(this.legacyPath)) || !legacyHasBoard(this.legacyPath)) { this.noLegacyBinding = true; return false; }
      let marker;
      try { marker = JSON.parse(await readFile(this.markerPath, "utf8")); } catch (error) { if (error?.code !== "ENOENT") throw error; }
      if (marker !== undefined && (marker.version !== VERSION || !["copying", "complete"].includes(marker.phase))) failure("legacy project task binding marker is invalid", "PROJECT_ENTRY_LEGACY_BINDING_INVALID");
      if (marker !== undefined) this.legacyBindingLaneRef = marker.laneRef;
      if (marker !== undefined && marker.laneRef !== laneRef) {
        if (bindLegacy === true) failure("legacy project task database is already bound to another canonical project", "PROJECT_ENTRY_LEGACY_BINDING_CONFLICT");
        return false;
      }
      if (marker === undefined) {
        const evidenced = await this.legacyEvidenceProvider();
        const evidencedLane = typeof evidenced === "string" && CANONICAL_KEY.test(evidenced) && evidenced === projectKey;
        if (!evidencedLane && bindLegacy !== true) failure("legacy project task database requires one explicit direct-human legacy binding", "PROJECT_ENTRY_LEGACY_BINDING_REQUIRED");
        if (await exists(databasePath)) failure("canonical project lane already contains task data; legacy binding was not applied", "PROJECT_ENTRY_LEGACY_BINDING_CONFLICT");
        marker = { version: VERSION, laneRef, phase: "copying" };
        await atomicJson(this.markerPath, marker);
        this.legacyBindingLaneRef = laneRef;
      }
      if (marker.phase === "complete" && await exists(databasePath)) return true;
      await atomicJson(this.markerPath, { version: VERSION, laneRef, phase: "copying" });
      const temporary = `${databasePath}.legacy-migration.tmp`;
      await removeWithRetry(temporary);
      await removeIncompleteDatabase(databasePath);
      try { await snapshotLegacyDatabase(this.legacyPath, temporary, databasePath); }
      finally { await removeWithRetry(temporary).catch(() => undefined); }
      await atomicJson(this.markerPath, { version: VERSION, laneRef, phase: "complete" });
      return true;
    });
    this.migrationChain = pending;
    this.laneModes.set(laneRef, pending);
    try {
      const result = await pending;
      this.laneModes.set(laneRef, Promise.resolve(result));
      return result;
    } catch (error) {
      if (this.laneModes.get(laneRef) === pending) this.laneModes.delete(laneRef);
      throw error;
    }
  }

  async close() { this.closed = true; await this.migrationChain.catch(() => undefined); }
}
