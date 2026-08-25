import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isAbsolute, posix, relative, resolve } from "node:path";

const AUTHORITY_PROTOCOL_VERSION = 1;
const WORKSPACE_HOST_STATE_VERSION = 1;
const MAX_HOST_STATE_BYTES = 32 * 1024 * 1024;
const MAX_HOST_RECORDS = 20_000;
const COMMIT_REF = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const DIGEST_REF = /^sha256:[a-f0-9]{64}$/u;
const CLAIM_MODES = new Set(["read", "write", "exclusive"]);
const ACTIVE_CLAIM_STATES = new Set(["active", "held_for_merge"]);
const MAX_LEASE_MS = 24 * 60 * 60 * 1_000;
const MAX_CLAIM_MS = 8 * 60 * 60 * 1_000;
const DEFAULT_LEASE_MS = 4 * 60 * 60 * 1_000;
const DEFAULT_CLAIM_MS = 2 * 60 * 60 * 1_000;
const MAX_MERGE_GROUP_SIZE = 32;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nonEmptyString(value, field, max = 2_000) {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) throw new TypeError(`${field} must be a non-empty string of at most ${max} characters`);
  return value.trim();
}
function safeTime(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${field} must be a non-negative safe integer timestamp`);
  return value;
}
function safePositiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${field} must be a positive safe integer`);
  return value;
}
function commitRef(value, field = "commitRef") {
  const ref = nonEmptyString(value, field, 64).toLowerCase();
  if (!COMMIT_REF.test(ref)) throw new TypeError(`${field} must be a 40- or 64-character lowercase hexadecimal commit`);
  return ref;
}
function digestRef(value, field = "digest") {
  const ref = nonEmptyString(value, field, 80).toLowerCase();
  if (!DIGEST_REF.test(ref)) throw new TypeError(`${field} must be a sha256 digest reference`);
  return ref;
}
function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}
function shaRef(prefix, value) {
  return `${prefix}_${createHash("sha256").update(value).digest("base64url")}`;
}
function opaqueRef(prefix, secret, ...parts) {
  return `${prefix}_${createHmac("sha256", secret).update(parts.map(String).join("\u0000")).digest("base64url").slice(0, 26)}`;
}
function immutable(value) {
  if (Array.isArray(value)) for (const item of value) immutable(item);
  else if (isRecord(value)) for (const nested of Object.values(value)) immutable(nested);
  return Object.freeze(value);
}
function assertLosslessJson(value, field = "value", seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") { if (!Number.isFinite(value)) throw new TypeError(`${field} contains a non-finite number`); return; }
  if (typeof value !== "object") throw new TypeError(`${field} must be lossless JSON`);
  if (seen.has(value)) throw new TypeError(`${field} contains a cycle`);
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) throw new TypeError(`${field} contains a sparse array`);
      assertLosslessJson(value[index], `${field}[${index}]`, seen);
    }
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${field} must contain plain objects only`);
    for (const [key, nested] of Object.entries(value)) assertLosslessJson(nested, `${field}.${key}`, seen);
  }
  seen.delete(value);
}
function cloneHostJson(value, field = "Host state") {
  assertLosslessJson(value, field);
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, "utf8") > MAX_HOST_STATE_BYTES) throw new RangeError(`${field} exceeds ${MAX_HOST_STATE_BYTES} bytes`);
  return JSON.parse(encoded);
}
function assertAllowedKeys(value, allowed, field) {
  const extras = Object.keys(value).filter((key) => !allowed.has(key));
  if (extras.length > 0) throw new TypeError(`${field} contains unsupported fields: ${extras.join(", ")}`);
}
function opaqueRecordRef(value, field, prefix) {
  const ref = nonEmptyString(value, field, 128);
  if (!new RegExp(`^${prefix}_[A-Za-z0-9_-]{8,96}$`, "u").test(ref)) throw new TypeError(`${field} is not a valid opaque reference`);
  return ref;
}
function normalizedPath(value, field) {
  return resolve(nonEmptyString(value, field, 4_096));
}
function isSameOrWithin(root, candidate) {
  const child = relative(root, candidate);
  return child === "" || (!child.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && child !== ".." && !isAbsolute(child));
}
function ensureDisjointPath(left, right, leftField, rightField) {
  if (isSameOrWithin(left, right) || isSameOrWithin(right, left)) throw new Error(`${leftField} and ${rightField} must be disjoint paths`);
}
function resourceRef(value, field = "resourceRef") {
  const raw = nonEmptyString(value, field, 1_024).replaceAll("\\", "/");
  if (raw.includes("\u0000") || raw.startsWith("/") || /^[A-Za-z]:\//u.test(raw)) throw new TypeError(`${field} must be repository-relative`);
  const normalized = posix.normalize(raw).replace(/^\.\//u, "").replace(/\/$/u, "");
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) throw new TypeError(`${field} escapes the repository`);
  return normalized;
}
function normalizeResources(values, field = "resources") {
  if (!Array.isArray(values) || values.length < 1 || values.length > 512) throw new TypeError(`${field} must contain from 1 through 512 entries`);
  return [...new Set(values.map((value, index) => resourceRef(value, `${field}[${index}]`)))].sort();
}
function resourcesOverlap(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}
function claimsConflict(left, right) {
  if (!left.resources.some((a) => right.resources.some((b) => resourcesOverlap(a, b)))) return "none";
  if (left.mode === "exclusive" || right.mode === "exclusive" || (left.mode === "write" && right.mode === "write")) return "hard";
  if (left.mode !== right.mode) return "advisory";
  return "none";
}
function coveredByClaim(file, claim) {
  return claim.resources.some((resource) => file === resource || file.startsWith(`${resource}/`));
}
function artifactEntries(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 1_000) throw new TypeError("artifacts must contain from 1 through 1000 entries");
  const names = new Set();
  return value.map((artifact, index) => {
    if (!isRecord(artifact)) throw new TypeError(`artifacts[${index}] must be an object`);
    const name = nonEmptyString(artifact.name, `artifacts[${index}].name`, 512);
    if (names.has(name)) throw new TypeError(`artifact name ${name} is duplicated`);
    names.add(name);
    const size = safeTime(artifact.size, `artifacts[${index}].size`);
    return immutable({ name, digest: digestRef(artifact.digest, `artifacts[${index}].digest`), size });
  }).sort((a, b) => a.name.localeCompare(b.name));
}
function canonicalArrayEquals(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}
function verifyHostStateMac(value) {
  const supplied = Buffer.from(nonEmptyString(value.stateMac, "hostState.stateMac", 256), "base64url");
  const body = { ...value };
  delete body.stateMac;
  const secret = nonEmptyString(body.secret, "hostState.secret", 512);
  if (secret.length < 24) throw new TypeError("hostState.secret must contain at least 24 characters");
  const wanted = createHmac("sha256", secret).update(canonicalJson(body)).digest();
  if (supplied.length !== wanted.length || !timingSafeEqual(supplied, wanted)) throw new Error("Workspace Authority Host state authentication failed");
  return { body, secret };
}
function normalizeWorkspaceHostState(input) {
  if (!isRecord(input)) throw new TypeError("Workspace Authority Host state must be an object");
  assertLosslessJson(input, "Workspace Authority Host state");
  assertAllowedKeys(input, new Set(["version", "stateKind", "projectRef", "repositoryRef", "authorityRoot", "sourceWorkspaceRoot", "workspaceRoot", "headCommit", "secret", "authorityEpoch", "fencingCounter", "workspaces", "claims", "changeSets", "queue", "mergeGroups", "artifactSets", "stateMac"]), "Workspace Authority Host state");
  if (input.version !== WORKSPACE_HOST_STATE_VERSION || input.stateKind !== "workspace-authority") throw new TypeError("unsupported Workspace Authority Host state version or kind");
  const { body, secret } = verifyHostStateMac(input);
  const value = cloneHostJson(body, "Workspace Authority Host state");
  const projectRef = nonEmptyString(value.projectRef, "hostState.projectRef", 128);
  const repositoryRef = nonEmptyString(value.repositoryRef, "hostState.repositoryRef", 128);
  const authorityRoot = normalizedPath(value.authorityRoot, "hostState.authorityRoot");
  const sourceWorkspaceRoot = normalizedPath(value.sourceWorkspaceRoot, "hostState.sourceWorkspaceRoot");
  const workspaceRoot = normalizedPath(value.workspaceRoot, "hostState.workspaceRoot");
  ensureDisjointPath(authorityRoot, sourceWorkspaceRoot, "authorityRoot", "sourceWorkspaceRoot");
  ensureDisjointPath(authorityRoot, workspaceRoot, "authorityRoot", "workspaceRoot");
  ensureDisjointPath(sourceWorkspaceRoot, workspaceRoot, "sourceWorkspaceRoot", "workspaceRoot");
  const headCommit = commitRef(value.headCommit, "hostState.headCommit");
  const authorityEpoch = safePositiveInteger(value.authorityEpoch, "hostState.authorityEpoch");
  const fencingCounter = safeTime(value.fencingCounter, "hostState.fencingCounter");
  for (const [name, records] of [["workspaces", value.workspaces], ["claims", value.claims], ["changeSets", value.changeSets], ["mergeGroups", value.mergeGroups], ["artifactSets", value.artifactSets]]) {
    if (!Array.isArray(records) || records.length > MAX_HOST_RECORDS) throw new TypeError(`hostState.${name} must be a bounded array`);
  }
  if (!Array.isArray(value.queue) || value.queue.length > MAX_HOST_RECORDS) throw new TypeError("hostState.queue must be a bounded array");
  const workspaces = new Map();
  for (const [index, workspace] of value.workspaces.entries()) {
    const field = `hostState.workspaces[${index}]`;
    if (!isRecord(workspace)) throw new TypeError(`${field} must be an object`);
    assertAllowedKeys(workspace, new Set(["version", "workspaceRef", "collaboratorRef", "taskRef", "workspacePath", "baseCommit", "authorityEpoch", "fencingToken", "state", "createdAt", "expiresAt", "updatedAt", "changeSetRef"]), field);
    if (workspace.version !== AUTHORITY_PROTOCOL_VERSION) throw new TypeError(`${field}.version is unsupported`);
    const workspaceRef = opaqueRecordRef(workspace.workspaceRef, `${field}.workspaceRef`, "workspace");
    if (workspaces.has(workspaceRef)) throw new TypeError(`${field}.workspaceRef is duplicated`);
    const workspacePath = normalizedPath(workspace.workspacePath, `${field}.workspacePath`);
    if (!isSameOrWithin(workspaceRoot, workspacePath) || workspacePath === workspaceRoot) throw new Error(`${field}.workspacePath is outside the isolated workspace root`);
    const entryEpoch = safePositiveInteger(workspace.authorityEpoch, `${field}.authorityEpoch`);
    if (entryEpoch > authorityEpoch) throw new Error(`${field}.authorityEpoch is from the future`);
    const fencingToken = nonEmptyString(workspace.fencingToken, `${field}.fencingToken`, 64);
    const fenceMatch = /^(\d+):(\d+)$/u.exec(fencingToken);
    if (!fenceMatch || Number(fenceMatch[1]) !== entryEpoch || Number(fenceMatch[2]) > fencingCounter) throw new Error(`${field}.fencingToken is invalid`);
    const state = nonEmptyString(workspace.state, `${field}.state`, 32);
    if (!new Set(["active", "published", "closed", "expired", "fenced"]).has(state)) throw new TypeError(`${field}.state is unsupported`);
    const normalized = { ...workspace, workspaceRef, collaboratorRef: nonEmptyString(workspace.collaboratorRef, `${field}.collaboratorRef`, 128), taskRef: nonEmptyString(workspace.taskRef, `${field}.taskRef`, 256), workspacePath, baseCommit: commitRef(workspace.baseCommit, `${field}.baseCommit`), authorityEpoch: entryEpoch, fencingToken, state, createdAt: safeTime(workspace.createdAt, `${field}.createdAt`), expiresAt: safeTime(workspace.expiresAt, `${field}.expiresAt`), updatedAt: safeTime(workspace.updatedAt, `${field}.updatedAt`) };
    if (workspace.changeSetRef !== undefined) normalized.changeSetRef = opaqueRecordRef(workspace.changeSetRef, `${field}.changeSetRef`, "changeset");
    workspaces.set(workspaceRef, normalized);
  }
  const claims = new Map();
  for (const [index, claim] of value.claims.entries()) {
    const field = `hostState.claims[${index}]`;
    if (!isRecord(claim)) throw new TypeError(`${field} must be an object`);
    assertAllowedKeys(claim, new Set(["version", "claimRef", "workspaceRef", "collaboratorRef", "taskRef", "authorityEpoch", "fencingToken", "mode", "resources", "state", "advisoryConflictRefs", "createdAt", "expiresAt", "updatedAt"]), field);
    if (claim.version !== AUTHORITY_PROTOCOL_VERSION) throw new TypeError(`${field}.version is unsupported`);
    const claimRef = opaqueRecordRef(claim.claimRef, `${field}.claimRef`, "claim");
    const workspaceRef = opaqueRecordRef(claim.workspaceRef, `${field}.workspaceRef`, "workspace");
    const workspace = workspaces.get(workspaceRef);
    if (workspace === undefined || workspace.collaboratorRef !== claim.collaboratorRef || workspace.taskRef !== claim.taskRef || workspace.fencingToken !== claim.fencingToken) throw new Error(`${field} does not bind its workspace`);
    const mode = nonEmptyString(claim.mode, `${field}.mode`, 32);
    if (!CLAIM_MODES.has(mode)) throw new TypeError(`${field}.mode is unsupported`);
    const resources = normalizeResources(claim.resources, `${field}.resources`);
    if (!canonicalArrayEquals(resources, claim.resources)) throw new Error(`${field}.resources are not canonical`);
    const state = nonEmptyString(claim.state, `${field}.state`, 32);
    if (!new Set(["active", "held_for_merge", "released", "expired", "fenced"]).has(state)) throw new TypeError(`${field}.state is unsupported`);
    if (!Array.isArray(claim.advisoryConflictRefs) || claim.advisoryConflictRefs.length > MAX_HOST_RECORDS) throw new TypeError(`${field}.advisoryConflictRefs is invalid`);
    const advisoryConflictRefs = claim.advisoryConflictRefs.map((ref, itemIndex) => opaqueRecordRef(ref, `${field}.advisoryConflictRefs[${itemIndex}]`, "claim"));
    if (claims.has(claimRef)) throw new TypeError(`${field}.claimRef is duplicated`);
    const claimEpoch = safePositiveInteger(claim.authorityEpoch, `${field}.authorityEpoch`);
    if (claimEpoch !== workspace.authorityEpoch) throw new Error(`${field}.authorityEpoch does not match its workspace`);
    claims.set(claimRef, { ...claim, claimRef, workspaceRef, authorityEpoch: claimEpoch, mode, resources, state, advisoryConflictRefs, createdAt: safeTime(claim.createdAt, `${field}.createdAt`), expiresAt: safeTime(claim.expiresAt, `${field}.expiresAt`), updatedAt: safeTime(claim.updatedAt, `${field}.updatedAt`) });
  }
  for (const claim of claims.values()) { const workspace = workspaces.get(claim.workspaceRef); if (workspace.state === "closed" && claim.state === "active") throw new Error("closed workspace cannot retain an active claim"); if (workspace.state === "active" && claim.state === "held_for_merge") throw new Error("active workspace cannot hold a merge claim"); }
  const changeSets = new Map();
  const changeSetByDigest = new Map();
  for (const [index, changeSet] of value.changeSets.entries()) {
    const field = `hostState.changeSets[${index}]`;
    if (!isRecord(changeSet)) throw new TypeError(`${field} must be an object`);
    assertAllowedKeys(changeSet, new Set(["version", "projectRef", "repositoryRef", "authorityEpoch", "collaboratorRef", "taskRef", "baseCommit", "commit", "diffDigest", "treeDigest", "files", "claimRefs", "message", "changeSetRef", "contentDigest", "state", "createdAt", "updatedAt", "mergeGroupRef", "landedCommit"]), field);
    if (changeSet.version !== AUTHORITY_PROTOCOL_VERSION || changeSet.projectRef !== projectRef || changeSet.repositoryRef !== repositoryRef) throw new Error(`${field} scope or version is invalid`);
    const files = normalizeResources(changeSet.files, `${field}.files`);
    if (!canonicalArrayEquals(files, changeSet.files)) throw new Error(`${field}.files are not canonical`);
    if (!Array.isArray(changeSet.claimRefs) || changeSet.claimRefs.length < 1) throw new TypeError(`${field}.claimRefs is invalid`);
    const claimRefs = changeSet.claimRefs.map((ref, itemIndex) => opaqueRecordRef(ref, `${field}.claimRefs[${itemIndex}]`, "claim")).sort();
    if (!canonicalArrayEquals(claimRefs, changeSet.claimRefs)) throw new Error(`${field}.claimRefs are not canonical`);
    for (const claimRef of claimRefs) if (!claims.has(claimRef)) throw new Error(`${field} references an unknown claim`);
    for (const claimRef of claimRefs) {
      const claim = claims.get(claimRef);
      if (claim.collaboratorRef !== changeSet.collaboratorRef || claim.taskRef !== changeSet.taskRef) throw new Error(`${field} claim identity binding is invalid`);
    }
    const bodyForDigest = { version: AUTHORITY_PROTOCOL_VERSION, projectRef, repositoryRef, authorityEpoch: safePositiveInteger(changeSet.authorityEpoch, `${field}.authorityEpoch`), collaboratorRef: nonEmptyString(changeSet.collaboratorRef, `${field}.collaboratorRef`, 128), taskRef: nonEmptyString(changeSet.taskRef, `${field}.taskRef`, 256), baseCommit: commitRef(changeSet.baseCommit, `${field}.baseCommit`), commit: commitRef(changeSet.commit, `${field}.commit`), diffDigest: digestRef(changeSet.diffDigest, `${field}.diffDigest`), treeDigest: digestRef(changeSet.treeDigest, `${field}.treeDigest`), files, claimRefs, message: nonEmptyString(changeSet.message, `${field}.message`, 2_000) };
    const changeSetRef = opaqueRecordRef(changeSet.changeSetRef, `${field}.changeSetRef`, "changeset");
    const wantedRef = shaRef("changeset", Buffer.from(canonicalJson(bodyForDigest)));
    const contentDigest = digestRef(changeSet.contentDigest, `${field}.contentDigest`);
    const wantedDigest = `sha256:${createHash("sha256").update(canonicalJson(bodyForDigest)).digest("hex")}`;
    if (changeSetRef !== wantedRef || contentDigest !== wantedDigest) throw new Error(`${field} content address is invalid`);
    const state = nonEmptyString(changeSet.state, `${field}.state`, 32);
    if (!new Set(["published", "queued", "needs_rebase", "merging", "conflicted", "landed"]).has(state)) throw new TypeError(`${field}.state is unsupported`);
    const normalized = { ...bodyForDigest, changeSetRef, contentDigest, state, createdAt: safeTime(changeSet.createdAt, `${field}.createdAt`), updatedAt: safeTime(changeSet.updatedAt, `${field}.updatedAt`) };
    if (changeSet.mergeGroupRef !== undefined) normalized.mergeGroupRef = opaqueRecordRef(changeSet.mergeGroupRef, `${field}.mergeGroupRef`, "mergegroup");
    if (changeSet.landedCommit !== undefined) normalized.landedCommit = commitRef(changeSet.landedCommit, `${field}.landedCommit`);
    if (changeSets.has(changeSetRef) || changeSetByDigest.has(contentDigest)) throw new TypeError(`${field} is duplicated`);
    const frozen = immutable(normalized);
    changeSets.set(changeSetRef, frozen);
    changeSetByDigest.set(contentDigest, changeSetRef);
  }
  const queue = value.queue.map((ref, index) => opaqueRecordRef(ref, `hostState.queue[${index}]`, "changeset"));
  if (new Set(queue).size !== queue.length) throw new Error("hostState.queue contains duplicates");
  for (const ref of queue) if (changeSets.get(ref)?.state !== "queued") throw new Error("hostState.queue references a non-queued ChangeSet");
  const mergeGroups = new Map();
  for (const [index, group] of value.mergeGroups.entries()) {
    const field = `hostState.mergeGroups[${index}]`;
    if (!isRecord(group)) throw new TypeError(`${field} must be an object`);
    assertAllowedKeys(group, new Set(["version", "projectRef", "repositoryRef", "authorityEpoch", "baseHead", "changeSetRefs", "mergeGroupRef", "inputDigest", "state", "createdAt", "updatedAt", "conflicts", "resultCommit", "treeDigest", "artifactSetRef", "gateReceiptRef", "landedAt"]), field);
    if (group.version !== AUTHORITY_PROTOCOL_VERSION || group.projectRef !== projectRef || group.repositoryRef !== repositoryRef) throw new Error(`${field} scope or version is invalid`);
    if (!Array.isArray(group.changeSetRefs) || group.changeSetRefs.length < 1 || group.changeSetRefs.length > MAX_MERGE_GROUP_SIZE) throw new TypeError(`${field}.changeSetRefs is invalid`);
    const changeSetRefs = group.changeSetRefs.map((ref, itemIndex) => opaqueRecordRef(ref, `${field}.changeSetRefs[${itemIndex}]`, "changeset"));
    if (new Set(changeSetRefs).size !== changeSetRefs.length) throw new Error(`${field}.changeSetRefs contains duplicates`);
    for (const ref of changeSetRefs) if (!changeSets.has(ref)) throw new Error(`${field} references an unknown ChangeSet`);
    const bodyForDigest = { version: AUTHORITY_PROTOCOL_VERSION, projectRef, repositoryRef, authorityEpoch: safePositiveInteger(group.authorityEpoch, `${field}.authorityEpoch`), baseHead: commitRef(group.baseHead, `${field}.baseHead`), changeSetRefs };
    const mergeGroupRef = opaqueRecordRef(group.mergeGroupRef, `${field}.mergeGroupRef`, "mergegroup");
    const wantedRef = shaRef("mergegroup", Buffer.from(canonicalJson(bodyForDigest)));
    const inputDigest = digestRef(group.inputDigest, `${field}.inputDigest`);
    const wantedDigest = `sha256:${createHash("sha256").update(canonicalJson(bodyForDigest)).digest("hex")}`;
    if (mergeGroupRef !== wantedRef || inputDigest !== wantedDigest) throw new Error(`${field} content address is invalid`);
    const state = nonEmptyString(group.state, `${field}.state`, 32);
    if (!new Set(["planned", "conflicted", "merged", "built", "landed", "fenced"]).has(state)) throw new TypeError(`${field}.state is unsupported`);
    const normalized = { ...bodyForDigest, mergeGroupRef, inputDigest, state, createdAt: safeTime(group.createdAt, `${field}.createdAt`), updatedAt: safeTime(group.updatedAt, `${field}.updatedAt`) };
    if (group.conflicts !== undefined) {
      if (!Array.isArray(group.conflicts)) throw new TypeError(`${field}.conflicts must be an array`);
      normalized.conflicts = group.conflicts.length === 0 ? [] : normalizeResources(group.conflicts, `${field}.conflicts`);
      if (!canonicalArrayEquals(normalized.conflicts, group.conflicts)) throw new Error(`${field}.conflicts are not canonical`);
    }
    if (group.resultCommit !== undefined) normalized.resultCommit = commitRef(group.resultCommit, `${field}.resultCommit`);
    if (group.treeDigest !== undefined) normalized.treeDigest = digestRef(group.treeDigest, `${field}.treeDigest`);
    if (group.artifactSetRef !== undefined) normalized.artifactSetRef = opaqueRecordRef(group.artifactSetRef, `${field}.artifactSetRef`, "artifactset");
    if (group.gateReceiptRef !== undefined) normalized.gateReceiptRef = nonEmptyString(group.gateReceiptRef, `${field}.gateReceiptRef`, 128);
    if (group.landedAt !== undefined) normalized.landedAt = safeTime(group.landedAt, `${field}.landedAt`);
    if (mergeGroups.has(mergeGroupRef)) throw new TypeError(`${field}.mergeGroupRef is duplicated`);
    mergeGroups.set(mergeGroupRef, immutable(normalized));
  }
  const artifactSets = new Map();
  for (const [index, artifactSet] of value.artifactSets.entries()) {
    const field = `hostState.artifactSets[${index}]`;
    if (!isRecord(artifactSet)) throw new TypeError(`${field} must be an object`);
    assertAllowedKeys(artifactSet, new Set(["version", "projectRef", "repositoryRef", "authorityEpoch", "mergeGroupRef", "commit", "buildEnvironmentDigest", "artifacts", "artifactSetRef", "manifestDigest", "createdAt"]), field);
    if (artifactSet.version !== AUTHORITY_PROTOCOL_VERSION || artifactSet.projectRef !== projectRef || artifactSet.repositoryRef !== repositoryRef) throw new Error(`${field} scope or version is invalid`);
    const artifacts = artifactEntries(artifactSet.artifacts);
    if (!canonicalArrayEquals(artifacts, artifactSet.artifacts)) throw new Error(`${field}.artifacts are not canonical`);
    const bodyForDigest = { version: AUTHORITY_PROTOCOL_VERSION, projectRef, repositoryRef, authorityEpoch: safePositiveInteger(artifactSet.authorityEpoch, `${field}.authorityEpoch`), mergeGroupRef: opaqueRecordRef(artifactSet.mergeGroupRef, `${field}.mergeGroupRef`, "mergegroup"), commit: commitRef(artifactSet.commit, `${field}.commit`), buildEnvironmentDigest: digestRef(artifactSet.buildEnvironmentDigest, `${field}.buildEnvironmentDigest`), artifacts };
    if (!mergeGroups.has(bodyForDigest.mergeGroupRef)) throw new Error(`${field} references an unknown merge group`);
    const artifactSetRef = opaqueRecordRef(artifactSet.artifactSetRef, `${field}.artifactSetRef`, "artifactset");
    const manifestDigest = digestRef(artifactSet.manifestDigest, `${field}.manifestDigest`);
    if (artifactSetRef !== shaRef("artifactset", Buffer.from(canonicalJson(bodyForDigest))) || manifestDigest !== `sha256:${createHash("sha256").update(canonicalJson(artifacts)).digest("hex")}`) throw new Error(`${field} content address is invalid`);
    if (artifactSets.has(artifactSetRef)) throw new TypeError(`${field}.artifactSetRef is duplicated`);
    artifactSets.set(artifactSetRef, immutable({ ...bodyForDigest, artifactSetRef, manifestDigest, createdAt: safeTime(artifactSet.createdAt, `${field}.createdAt`) }));
  }
  for (const workspace of workspaces.values()) if (workspace.changeSetRef !== undefined && !changeSets.has(workspace.changeSetRef)) throw new Error("workspace references an unknown ChangeSet");
  for (const claim of claims.values()) for (const ref of claim.advisoryConflictRefs) if (!claims.has(ref)) throw new Error("claim references an unknown advisory conflict");
  for (const changeSet of changeSets.values()) if (changeSet.mergeGroupRef !== undefined && !mergeGroups.has(changeSet.mergeGroupRef)) throw new Error("ChangeSet references an unknown merge group");
  for (const group of mergeGroups.values()) if (group.artifactSetRef !== undefined && !artifactSets.has(group.artifactSetRef)) throw new Error("merge group references an unknown ArtifactSet");
  return { projectRef, repositoryRef, authorityRoot, sourceWorkspaceRoot, workspaceRoot, headCommit, secret, authorityEpoch, fencingCounter, workspaces, claims, changeSets, changeSetByDigest, queue, mergeGroups, artifactSets };
}

export class WorkspaceAuthority {
  constructor({ projectRef, repositoryRef, authorityRoot, sourceWorkspaceRoot, workspaceRoot, initialHead, secret = randomBytes(32).toString("base64url"), hostState, now = Date.now, verifyGateReceipt = () => false } = {}) {
    if (typeof now !== "function") throw new TypeError("now must be a function");
    if (typeof verifyGateReceipt !== "function") throw new TypeError("verifyGateReceipt must be a function");
    this.now = now;
    this.verifyGateReceipt = verifyGateReceipt;
    if (hostState !== undefined) {
      const restored = normalizeWorkspaceHostState(hostState);
      Object.assign(this, restored);
      return;
    }
    this.projectRef = nonEmptyString(projectRef, "projectRef", 128);
    this.repositoryRef = nonEmptyString(repositoryRef, "repositoryRef", 128);
    this.authorityRoot = normalizedPath(authorityRoot, "authorityRoot");
    this.sourceWorkspaceRoot = normalizedPath(sourceWorkspaceRoot, "sourceWorkspaceRoot");
    this.workspaceRoot = normalizedPath(workspaceRoot, "workspaceRoot");
    ensureDisjointPath(this.authorityRoot, this.sourceWorkspaceRoot, "authorityRoot", "sourceWorkspaceRoot");
    ensureDisjointPath(this.authorityRoot, this.workspaceRoot, "authorityRoot", "workspaceRoot");
    ensureDisjointPath(this.sourceWorkspaceRoot, this.workspaceRoot, "sourceWorkspaceRoot", "workspaceRoot");
    this.headCommit = commitRef(initialHead, "initialHead");
    this.secret = nonEmptyString(secret, "secret", 512);
    if (this.secret.length < 24) throw new TypeError("secret must contain at least 24 characters");
    this.authorityEpoch = 1;
    this.fencingCounter = 0;
    this.workspaces = new Map();
    this.claims = new Map();
    this.changeSets = new Map();
    this.changeSetByDigest = new Map();
    this.queue = [];
    this.mergeGroups = new Map();
    this.artifactSets = new Map();
  }

  static restore(hostState, options = {}) {
    return new WorkspaceAuthority({ ...options, hostState });
  }

  toJSON() {
    return this.status();
  }

  exportHostState() {
    const body = cloneHostJson({
      version: WORKSPACE_HOST_STATE_VERSION,
      stateKind: "workspace-authority",
      projectRef: this.projectRef,
      repositoryRef: this.repositoryRef,
      authorityRoot: this.authorityRoot,
      sourceWorkspaceRoot: this.sourceWorkspaceRoot,
      workspaceRoot: this.workspaceRoot,
      headCommit: this.headCommit,
      secret: this.secret,
      authorityEpoch: this.authorityEpoch,
      fencingCounter: this.fencingCounter,
      workspaces: [...this.workspaces.values()],
      claims: [...this.claims.values()],
      changeSets: [...this.changeSets.values()],
      queue: this.queue,
      mergeGroups: [...this.mergeGroups.values()],
      artifactSets: [...this.artifactSets.values()],
    }, "Workspace Authority Host state");
    return { ...body, stateMac: createHmac("sha256", this.secret).update(canonicalJson(body)).digest("base64url") };
  }

  status() {
    this.#expire();
    return immutable({
      version: AUTHORITY_PROTOCOL_VERSION,
      projectRef: this.projectRef,
      repositoryRef: this.repositoryRef,
      authorityEpoch: this.authorityEpoch,
      headCommit: this.headCommit,
      activeWorkspaceCount: [...this.workspaces.values()].filter((entry) => entry.state === "active").length,
      activeClaimCount: [...this.claims.values()].filter((entry) => ACTIVE_CLAIM_STATES.has(entry.state)).length,
      queuedChangeSetCount: this.queue.length,
    });
  }

  openWorkspace({ collaboratorRef, taskRef, workspacePath, baseCommit = this.headCommit, leaseMs = DEFAULT_LEASE_MS } = {}) {
    this.#expire();
    const collaborator = nonEmptyString(collaboratorRef, "collaboratorRef", 128);
    const task = nonEmptyString(taskRef, "taskRef", 256);
    const path = normalizedPath(workspacePath, "workspacePath"), base = commitRef(baseCommit, "baseCommit");
    if (!isSameOrWithin(this.workspaceRoot, path) || path === this.workspaceRoot) throw new Error("workspacePath must be a dedicated child of workspaceRoot");
    for (const workspace of this.workspaces.values()) {
      if (workspace.state !== "active" || (workspace.workspacePath !== path && (workspace.collaboratorRef !== collaborator || workspace.taskRef !== task))) continue;
      if (workspace.workspacePath === path && workspace.collaboratorRef === collaborator && workspace.taskRef === task && workspace.baseCommit === base) return this.#publicWorkspace(workspace);
      throw new Error("an active isolated workspace already owns this path or collaborator/task pair");
    }
    const duration = safePositiveInteger(leaseMs, "leaseMs");
    if (duration > MAX_LEASE_MS) throw new RangeError(`leaseMs exceeds ${MAX_LEASE_MS}`);
    const current = this.now();
    const fence = `${this.authorityEpoch}:${++this.fencingCounter}`;
    const workspaceRef = opaqueRef("workspace", this.secret, this.projectRef, collaborator, task, path, fence);
    const workspace = {
      version: AUTHORITY_PROTOCOL_VERSION,
      workspaceRef,
      collaboratorRef: collaborator,
      taskRef: task,
      workspacePath: path,
      baseCommit: base,
      authorityEpoch: this.authorityEpoch,
      fencingToken: fence,
      state: "active",
      createdAt: current,
      expiresAt: current + duration,
      updatedAt: current,
    };
    this.workspaces.set(workspaceRef, workspace);
    return this.#publicWorkspace(workspace);
  }

  closeWorkspace({ workspaceRef, fencingToken } = {}) {
    this.#expire();
    const ref = opaqueRecordRef(workspaceRef, "workspaceRef", "workspace");
    const fence = nonEmptyString(fencingToken, "fencingToken", 64);
    const workspace = this.workspaces.get(ref);
    if (workspace === undefined) throw new Error("isolated workspace is unknown");
    if (workspace.fencingToken !== fence || workspace.authorityEpoch !== this.authorityEpoch) throw new Error("isolated workspace fencing token is stale");
    if (workspace.state === "closed") return this.#publicWorkspace(workspace);
    if (!new Set(["active", "published"]).has(workspace.state)) throw new Error("isolated workspace cannot be closed in its current state");
    const current = this.now();
    workspace.state = "closed"; workspace.updatedAt = current;
    for (const claim of this.claims.values()) if (claim.workspaceRef === ref && claim.state === "active") { claim.state = "released"; claim.updatedAt = current; }
    return this.#publicWorkspace(workspace);
  }

  claimResources({ workspaceRef, mode, resources, claimMs = DEFAULT_CLAIM_MS } = {}) {
    this.#expire();
    const workspace = this.#activeWorkspace(workspaceRef);
    const normalizedMode = nonEmptyString(mode, "mode", 32);
    if (!CLAIM_MODES.has(normalizedMode)) throw new TypeError("mode must be read, write, or exclusive");
    const normalizedResources = normalizeResources(resources);
    const duration = safePositiveInteger(claimMs, "claimMs");
    if (duration > MAX_CLAIM_MS) throw new RangeError(`claimMs exceeds ${MAX_CLAIM_MS}`);
    const current = this.now();
    const candidate = { mode: normalizedMode, resources: normalizedResources }, resourceKey = canonicalJson(normalizedResources);
    for (const claim of this.claims.values()) {
      if (claim.workspaceRef !== workspace.workspaceRef || claim.state !== "active" || canonicalJson(claim.resources) !== resourceKey) continue;
      if (claim.mode === normalizedMode) return immutable(this.#publicClaim(claim));
    }
    const hardConflicts = [];
    const advisoryConflicts = [];
    for (const claim of this.claims.values()) {
      if (!ACTIVE_CLAIM_STATES.has(claim.state) || claim.workspaceRef === workspace.workspaceRef) continue;
      const conflict = claimsConflict(candidate, claim);
      if (conflict === "hard") hardConflicts.push(claim.claimRef);
      else if (conflict === "advisory") advisoryConflicts.push(claim.claimRef);
    }
    if (hardConflicts.length > 0) {
      const error = new Error("resource claim conflicts with active write or exclusive ownership");
      error.code = "RESOURCE_CONFLICT";
      error.conflictRefs = [...hardConflicts];
      throw error;
    }
    const expiresAt = Math.min(workspace.expiresAt, current + duration);
    const claimRef = opaqueRef("claim", this.secret, workspace.workspaceRef, normalizedMode, canonicalJson(normalizedResources), workspace.fencingToken, current);
    const claim = {
      version: AUTHORITY_PROTOCOL_VERSION,
      claimRef,
      workspaceRef: workspace.workspaceRef,
      collaboratorRef: workspace.collaboratorRef,
      taskRef: workspace.taskRef,
      authorityEpoch: this.authorityEpoch,
      fencingToken: workspace.fencingToken,
      mode: normalizedMode,
      resources: normalizedResources,
      state: "active",
      advisoryConflictRefs: [...advisoryConflicts],
      createdAt: current,
      expiresAt,
      updatedAt: current,
    };
    this.claims.set(claimRef, claim);
    return immutable(this.#publicClaim(claim));
  }

  publishChangeSet({ workspaceRef, commit, parentCommit, diffDigest, treeDigest, files, claimRefs, message } = {}) {
    this.#expire();
    const ref = nonEmptyString(workspaceRef, "workspaceRef", 128);
    const workspace = this.workspaces.get(ref);
    if (workspace === undefined || !new Set(["active", "published"]).has(workspace.state) || workspace.expiresAt <= this.now()) throw new Error("isolated workspace cannot publish a ChangeSet");
    if (workspace.authorityEpoch !== this.authorityEpoch || workspace.fencingToken.split(":", 1)[0] !== String(this.authorityEpoch)) throw new Error("workspace authority epoch is stale");
    const parent = commitRef(parentCommit, "parentCommit");
    if (parent !== workspace.baseCommit) throw new Error("ChangeSet parent must equal its isolated workspace base commit");
    const normalizedFiles = normalizeResources(files, "files");
    if (!Array.isArray(claimRefs) || claimRefs.length < 1) throw new TypeError("claimRefs must contain at least one claim");
    const selectedClaims = [...new Set(claimRefs)].map((claimRef) => {
      const claim = this.claims.get(nonEmptyString(claimRef, "claimRef", 128));
      if (claim === undefined || claim.workspaceRef !== workspace.workspaceRef || !new Set(["active", "held_for_merge"]).has(claim.state) || (claim.mode !== "write" && claim.mode !== "exclusive")) throw new Error("ChangeSet requires active write or exclusive claims from its workspace");
      return claim;
    });
    for (const file of normalizedFiles) if (!selectedClaims.some((claim) => coveredByClaim(file, claim))) throw new Error(`ChangeSet file ${file} is not covered by an active write claim`);
    const body = {
      version: AUTHORITY_PROTOCOL_VERSION,
      projectRef: this.projectRef,
      repositoryRef: this.repositoryRef,
      authorityEpoch: this.authorityEpoch,
      collaboratorRef: workspace.collaboratorRef,
      taskRef: workspace.taskRef,
      baseCommit: parent,
      commit: commitRef(commit, "commit"),
      diffDigest: digestRef(diffDigest, "diffDigest"),
      treeDigest: digestRef(treeDigest, "treeDigest"),
      files: normalizedFiles,
      claimRefs: selectedClaims.map((claim) => claim.claimRef).sort(),
      message: nonEmptyString(message, "message", 2_000),
    };
    const contentDigest = digestRef(`sha256:${createHash("sha256").update(canonicalJson(body)).digest("hex")}`, "contentDigest");
    const existingRef = this.changeSetByDigest.get(contentDigest);
    if (existingRef !== undefined) {
      if (workspace.state === "published" && workspace.changeSetRef !== existingRef) throw new Error("isolated workspace already published a different ChangeSet");
      workspace.state = "published";
      workspace.changeSetRef = existingRef;
      workspace.updatedAt = this.now();
      for (const claim of selectedClaims) { claim.state = "held_for_merge"; claim.updatedAt = workspace.updatedAt; }
      return this.changeSets.get(existingRef);
    }
    if (workspace.state === "published") throw new Error("isolated workspace already published a different ChangeSet");
    const current = this.now();
    const changeSetRef = shaRef("changeset", Buffer.from(canonicalJson(body)));
    const changeSet = immutable({ ...body, changeSetRef, contentDigest, state: "published", createdAt: current, updatedAt: current });
    this.changeSets.set(changeSetRef, changeSet);
    this.changeSetByDigest.set(contentDigest, changeSetRef);
    workspace.state = "published";
    workspace.changeSetRef = changeSetRef;
    workspace.updatedAt = current;
    for (const claim of selectedClaims) { claim.state = "held_for_merge"; claim.updatedAt = current; }
    return changeSet;
  }

  enqueueChangeSet(changeSetRef) {
    this.#expire();
    const ref = nonEmptyString(changeSetRef, "changeSetRef", 128);
    const changeSet = this.changeSets.get(ref);
    if (changeSet === undefined) throw new Error("ChangeSet is unknown");
    if (!new Set(["published", "queued"]).has(changeSet.state)) throw new Error("ChangeSet is not eligible for the merge queue");
    if (!this.queue.includes(ref)) this.queue.push(ref);
    this.#replaceChangeSet(ref, { state: "queued", updatedAt: this.now() });
    return immutable({ changeSetRef: ref, queuePosition: this.queue.indexOf(ref), queued: true });
  }

  planMergeGroup({ maxChangeSets = MAX_MERGE_GROUP_SIZE } = {}) {
    this.#expire();
    const maximum = safePositiveInteger(maxChangeSets, "maxChangeSets");
    if (maximum > MAX_MERGE_GROUP_SIZE) throw new RangeError(`maxChangeSets exceeds ${MAX_MERGE_GROUP_SIZE}`);
    const selected = [];
    const selectedFiles = [];
    const stale = [];
    for (const ref of this.queue) {
      if (selected.length >= maximum) break;
      const changeSet = this.changeSets.get(ref);
      if (changeSet.baseCommit !== this.headCommit) { stale.push(ref); continue; }
      if (changeSet.files.some((file) => selectedFiles.some((selectedFile) => resourcesOverlap(file, selectedFile)))) continue;
      selected.push(ref);
      selectedFiles.push(...changeSet.files);
    }
    for (const ref of stale) {
      this.queue = this.queue.filter((candidate) => candidate !== ref);
      this.#replaceChangeSet(ref, { state: "needs_rebase", updatedAt: this.now() });
    }
    if (selected.length === 0) return undefined;
    this.queue = this.queue.filter((ref) => !selected.includes(ref));
    const current = this.now();
    const body = { version: AUTHORITY_PROTOCOL_VERSION, projectRef: this.projectRef, repositoryRef: this.repositoryRef, authorityEpoch: this.authorityEpoch, baseHead: this.headCommit, changeSetRefs: selected };
    const mergeGroupRef = shaRef("mergegroup", Buffer.from(canonicalJson(body)));
    const group = immutable({ ...body, mergeGroupRef, inputDigest: digestRef(`sha256:${createHash("sha256").update(canonicalJson(body)).digest("hex")}`), state: "planned", createdAt: current, updatedAt: current });
    this.mergeGroups.set(mergeGroupRef, group);
    for (const ref of selected) this.#replaceChangeSet(ref, { state: "merging", mergeGroupRef, updatedAt: current });
    return group;
  }

  recordMergeResult({ mergeGroupRef, resultCommit, treeDigest, conflicts = [] } = {}) {
    const group = this.#mergeGroup(mergeGroupRef);
    if (group.state !== "planned") throw new Error("merge group is not awaiting a result");
    if (!Array.isArray(conflicts) || conflicts.length > 512) throw new TypeError("conflicts must be an array with at most 512 entries");
    const normalizedConflicts = conflicts.map((value, index) => resourceRef(value, `conflicts[${index}]`));
    const current = this.now();
    if (normalizedConflicts.length > 0) {
      const updated = this.#replaceMergeGroup(group.mergeGroupRef, { state: "conflicted", conflicts: [...new Set(normalizedConflicts)].sort(), updatedAt: current });
      for (const ref of group.changeSetRefs) this.#replaceChangeSet(ref, { state: "conflicted", updatedAt: current });
      return updated;
    }
    return this.#replaceMergeGroup(group.mergeGroupRef, { state: "merged", resultCommit: commitRef(resultCommit, "resultCommit"), treeDigest: digestRef(treeDigest, "treeDigest"), conflicts: [], updatedAt: current });
  }

  recordArtifactSet({ mergeGroupRef, commit, buildEnvironmentDigest, artifacts } = {}) {
    const group = this.#mergeGroup(mergeGroupRef);
    if (!new Set(["merged", "built"]).has(group.state)) throw new Error("artifacts require a conflict-free merged group");
    const commitValue = commitRef(commit, "commit");
    if (commitValue !== group.resultCommit) throw new Error("ArtifactSet commit must equal the merge result commit");
    const normalizedArtifacts = artifactEntries(artifacts);
    const body = {
      version: AUTHORITY_PROTOCOL_VERSION,
      projectRef: this.projectRef,
      repositoryRef: this.repositoryRef,
      authorityEpoch: this.authorityEpoch,
      mergeGroupRef: group.mergeGroupRef,
      commit: commitValue,
      buildEnvironmentDigest: digestRef(buildEnvironmentDigest, "buildEnvironmentDigest"),
      artifacts: normalizedArtifacts,
    };
    const artifactSetRef = shaRef("artifactset", Buffer.from(canonicalJson(body)));
    const existing = this.artifactSets.get(artifactSetRef);
    if (existing !== undefined && (group.state === "merged" || group.artifactSetRef === artifactSetRef)) return existing;
    if (group.state === "built") throw new Error("merge group already has a different immutable ArtifactSet");
    const record = immutable({ ...body, artifactSetRef, manifestDigest: digestRef(`sha256:${createHash("sha256").update(canonicalJson(normalizedArtifacts)).digest("hex")}`), createdAt: this.now() });
    this.artifactSets.set(artifactSetRef, record);
    this.#replaceMergeGroup(group.mergeGroupRef, { state: "built", artifactSetRef, updatedAt: this.now() });
    return record;
  }

  landMergeGroup({ mergeGroupRef, artifactSetRef, gateReceipt } = {}) {
    const group = this.#mergeGroup(mergeGroupRef);
    if (group.state !== "built") throw new Error("merge group is not built and ready for a gate");
    const artifacts = this.artifactSets.get(nonEmptyString(artifactSetRef, "artifactSetRef", 128));
    if (artifacts === undefined || artifacts.mergeGroupRef !== group.mergeGroupRef || artifacts.commit !== group.resultCommit) throw new Error("ArtifactSet does not bind this merge group result");
    if (group.baseHead !== this.headCommit) throw new Error("authority head changed after merge planning; the group must be rebuilt");
    const binding = immutable({
      projectRef: this.projectRef,
      repositoryRef: this.repositoryRef,
      authorityEpoch: this.authorityEpoch,
      mergeGroupRef: group.mergeGroupRef,
      baseHead: group.baseHead,
      resultCommit: group.resultCommit,
      artifactSetRef: artifacts.artifactSetRef,
      manifestDigest: artifacts.manifestDigest,
    });
    if (!isRecord(gateReceipt) || gateReceipt.decision !== "pass" || !this.verifyGateReceipt(gateReceipt, binding)) throw new Error("an authentic passing gate receipt bound to the exact build is required");
    const current = this.now();
    this.headCommit = group.resultCommit;
    const landedGroup = this.#replaceMergeGroup(group.mergeGroupRef, { state: "landed", gateReceiptRef: nonEmptyString(gateReceipt.gateReceiptRef, "gateReceiptRef", 128), landedAt: current, updatedAt: current });
    for (const ref of group.changeSetRefs) {
      const changeSet = this.changeSets.get(ref);
      this.#replaceChangeSet(ref, { state: "landed", landedCommit: group.resultCommit, updatedAt: current });
      for (const claimRef of changeSet.claimRefs) {
        const claim = this.claims.get(claimRef);
        if (claim !== undefined) { claim.state = "released"; claim.updatedAt = current; }
      }
    }
    return immutable({ landed: true, headCommit: this.headCommit, mergeGroup: landedGroup });
  }

  advanceAuthorityEpoch({ expectedHead } = {}) {
    if (commitRef(expectedHead, "expectedHead") !== this.headCommit) throw new Error("authority epoch promotion expected head does not match");
    const previousEpoch = this.authorityEpoch;
    this.authorityEpoch += 1;
    const current = this.now();
    for (const workspace of this.workspaces.values()) if (workspace.state === "active") { workspace.state = "fenced"; workspace.updatedAt = current; }
    for (const claim of this.claims.values()) if (ACTIVE_CLAIM_STATES.has(claim.state)) { claim.state = "fenced"; claim.updatedAt = current; }
    for (const [ref, group] of this.mergeGroups) if (!new Set(["landed", "conflicted", "fenced"]).has(group.state)) this.#replaceMergeGroup(ref, { state: "fenced", updatedAt: current });
    this.queue = [];
    return immutable({ projectRef: this.projectRef, repositoryRef: this.repositoryRef, previousEpoch, authorityEpoch: this.authorityEpoch, headCommit: this.headCommit, promotedAt: current });
  }

  #activeWorkspace(workspaceRef) {
    const ref = nonEmptyString(workspaceRef, "workspaceRef", 128);
    const workspace = this.workspaces.get(ref);
    if (workspace === undefined || workspace.state !== "active" || workspace.expiresAt <= this.now()) throw new Error("isolated workspace lease is unavailable or expired");
    if (workspace.authorityEpoch !== this.authorityEpoch || workspace.fencingToken.split(":", 1)[0] !== String(this.authorityEpoch)) throw new Error("isolated workspace fencing token is stale");
    return workspace;
  }

  #expire() {
    const current = this.now();
    for (const workspace of this.workspaces.values()) if (workspace.state === "active" && workspace.expiresAt <= current) { workspace.state = "expired"; workspace.updatedAt = current; }
    for (const claim of this.claims.values()) if (ACTIVE_CLAIM_STATES.has(claim.state) && claim.expiresAt <= current) { claim.state = "expired"; claim.updatedAt = current; }
  }

  #publicWorkspace(workspace) {
    return immutable({
      version: workspace.version,
      workspaceRef: workspace.workspaceRef,
      collaboratorRef: workspace.collaboratorRef,
      taskRef: workspace.taskRef,
      baseCommit: workspace.baseCommit,
      authorityEpoch: workspace.authorityEpoch,
      fencingToken: workspace.fencingToken,
      state: workspace.state,
      createdAt: workspace.createdAt,
      expiresAt: workspace.expiresAt,
    });
  }

  #publicClaim(claim) {
    return {
      version: claim.version,
      claimRef: claim.claimRef,
      workspaceRef: claim.workspaceRef,
      collaboratorRef: claim.collaboratorRef,
      taskRef: claim.taskRef,
      authorityEpoch: claim.authorityEpoch,
      mode: claim.mode,
      resources: [...claim.resources],
      state: claim.state,
      advisoryConflictRefs: [...claim.advisoryConflictRefs],
      createdAt: claim.createdAt,
      expiresAt: claim.expiresAt,
    };
  }

  #mergeGroup(ref) {
    const group = this.mergeGroups.get(nonEmptyString(ref, "mergeGroupRef", 128));
    if (group === undefined) throw new Error("merge group is unknown");
    if (group.authorityEpoch !== this.authorityEpoch) throw new Error("merge group authority epoch is stale");
    return group;
  }

  #replaceChangeSet(ref, patch) {
    const current = this.changeSets.get(ref);
    const replacement = immutable({ ...current, ...patch });
    this.changeSets.set(ref, replacement);
    return replacement;
  }

  #replaceMergeGroup(ref, patch) {
    const current = this.mergeGroups.get(ref);
    const replacement = immutable({ ...current, ...patch });
    this.mergeGroups.set(ref, replacement);
    return replacement;
  }
}

export {
  AUTHORITY_PROTOCOL_VERSION,
  CLAIM_MODES,
  DIGEST_REF,
  MAX_MERGE_GROUP_SIZE,
  WORKSPACE_HOST_STATE_VERSION,
};
