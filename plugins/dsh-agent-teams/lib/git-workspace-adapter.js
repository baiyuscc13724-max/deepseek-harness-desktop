import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, open, realpath, rename, rm, stat } from "node:fs/promises";
import { ArtifactContentAddressedStore } from "./artifact-cas.js";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

const COMMIT_REF = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const SAFE_REF = /^(?:repository|workspace|mergegroup|changeset)_[A-Za-z0-9_-]{8,96}$/u;
const DIGEST_REF = /^sha256:[a-f0-9]{64}$/u;
const DEFAULT_MAX_BUNDLE_BYTES = 512 * 1024 * 1024;
const BUNDLE_CHUNK_BYTES = 256 * 1024;
const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;
const DEFAULT_GIT_TIMEOUT_MS = 60_000;
const SAFE_ENV_KEYS = ["SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "LOCALAPPDATA", "APPDATA"];

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nonEmptyString(value, field, max = 2_000) {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) throw new TypeError(`${field} must be a non-empty string of at most ${max} characters`);
  return value.trim();
}
function normalizedPath(value, field) {
  return resolve(nonEmptyString(value, field, 4_096));
}
function samePath(left, right) {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}
function isSameOrWithin(root, candidate) {
  const child = relative(root, candidate);
  return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
}
function ensureDisjoint(left, right, leftField, rightField) {
  if (isSameOrWithin(left, right) || isSameOrWithin(right, left)) throw new Error(`${leftField} and ${rightField} must be disjoint paths`);
}
function commitRef(value, field = "commit") {
  const commit = nonEmptyString(value, field, 64).toLowerCase();
  if (!COMMIT_REF.test(commit)) throw new TypeError(`${field} must be a 40- or 64-character Git commit`);
  return commit;
}
function safeRef(value, field) {
  const ref = nonEmptyString(value, field, 128);
  if (!SAFE_REF.test(ref)) throw new TypeError(`${field} is not a safe opaque reference`);
  return ref;
}
function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
function digestRef(value, field = "digest") {
  const ref = nonEmptyString(value, field, 80).toLowerCase();
  if (!DIGEST_REF.test(ref)) throw new TypeError(`${field} must be a sha256 digest`);
  return ref;
}
function declaredFiles(value, field = "files") {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20_000) throw new TypeError(`${field} must contain from 1 through 20000 paths`);
  const normalized = value.map((item, index) => {
    const file = nonEmptyString(item, `${field}[${index}]`, 2_000).replaceAll("\\", "/");
    if (file.startsWith("/") || /^[A-Za-z]:\//u.test(file) || file.split("/").includes("..") || file.includes("\0")) throw new TypeError(`${field}[${index}] is unsafe`);
    return file;
  }).sort();
  if (new Set(normalized).size !== normalized.length) throw new TypeError(`${field} contains duplicate paths`);
  return normalized;
}
async function hashFile(filePath, maxBytes) {
  const metadata = await stat(filePath);
  if (!metadata.isFile() || metadata.size > maxBytes) throw new RangeError("Git bundle exceeds its size bound");
  const handle = await open(filePath, "r");
  const hash = createHash("sha256");
  let offset = 0;
  try {
    for (;;) {
      const buffer = Buffer.alloc(Math.min(BUNDLE_CHUNK_BYTES, Math.max(1, metadata.size - offset)));
      const result = await handle.read(buffer, 0, buffer.length, offset);
      if (result.bytesRead === 0) break;
      hash.update(buffer.subarray(0, result.bytesRead));
      offset += result.bytesRead;
      if (offset > maxBytes) throw new RangeError("Git bundle exceeds its size bound");
    }
  } finally { await handle.close(); }
  if (offset !== metadata.size) throw new Error("Git bundle changed while it was hashed");
  return { digest: `sha256:${hash.digest("hex")}`, size: metadata.size };
}
function buildEnvironment(source = process.env, gitCommand) {
  const env = Object.create(null);
  for (const key of SAFE_ENV_KEYS) if (typeof source[key] === "string" && source[key] !== "") env[key] = source[key];
  const gitDirectory = dirname(gitCommand);
  const gitRoot = new Set(["cmd", "bin"]).has(basename(gitDirectory).toLowerCase()) ? dirname(gitDirectory) : gitDirectory;
  const entries = [gitDirectory, resolve(gitRoot, "cmd"), resolve(gitRoot, "bin"), resolve(gitRoot, "mingw64", "bin"), resolve(gitRoot, "usr", "bin")];
  const systemRoot = source.SystemRoot || source.SYSTEMROOT || source.WINDIR;
  if (systemRoot) entries.push(resolve(systemRoot, "System32"), resolve(systemRoot));
  env.PATH = [...new Set(entries)].join(process.platform === "win32" ? ";" : ":");
  env.GIT_TERMINAL_PROMPT = "0";
  env.GCM_INTERACTIVE = "Never";
  env.GIT_ASKPASS = process.platform === "win32" ? "NUL" : "/bin/false";
  env.SSH_ASKPASS = env.GIT_ASKPASS;
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = process.platform === "win32" ? "NUL" : "/dev/null";
  env.GIT_CONFIG_SYSTEM = env.GIT_CONFIG_GLOBAL;
  env.LC_ALL = "C";
  env.LANG = "C";
  return env;
}
async function pathExists(value) {
  try { await stat(value); return true; } catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}
function immutable(value) {
  if (Buffer.isBuffer(value)) return value;
  if (Array.isArray(value)) for (const item of value) immutable(item);
  else if (isRecord(value)) for (const nested of Object.values(value)) immutable(nested);
  return Object.freeze(value);
}
function normalizeChangeSetDeclaration(value, repositoryRef) {
  if (!isRecord(value)) throw new TypeError("changeSet must be an object");
  const changeSetRef = safeRef(value.changeSetRef, "changeSet.changeSetRef");
  if (value.repositoryRef !== repositoryRef) throw new Error("ChangeSet belongs to another repository");
  return {
    changeSetRef,
    repositoryRef,
    commit: commitRef(value.commit, "changeSet.commit"),
    parentCommit: commitRef(value.parentCommit ?? value.baseCommit, "changeSet.parentCommit"),
    diffDigest: digestRef(value.diffDigest, "changeSet.diffDigest"),
    treeDigest: digestRef(value.treeDigest, "changeSet.treeDigest"),
    files: declaredFiles(value.files, "changeSet.files"),
  };
}
function parseNulPaths(bytes) {
  if (bytes.length === 0) return [];
  const parts = bytes.toString("utf8").split("\0");
  if (parts.at(-1) !== "") throw new Error("Git returned an unterminated path list");
  parts.pop();
  const unique = new Set();
  for (const value of parts) {
    if (value === "" || value.includes("\0") || value.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(value) || value.split(/[\\/]/u).includes("..")) throw new Error("Git returned an unsafe repository path");
    unique.add(value.replaceAll("\\", "/"));
  }
  return [...unique].sort();
}

export class GitWorkspaceAdapter {
  constructor({ gitCommand, allowedGitRoot, authorityRoot, sourceWorkspaceRoot, workspaceRoot, repositoryRef, spawnImpl = spawn, env = process.env, timeoutMs = DEFAULT_GIT_TIMEOUT_MS, maxBundleBytes = DEFAULT_MAX_BUNDLE_BYTES } = {}) {
    this.gitCommand = normalizedPath(gitCommand, "gitCommand");
    this.allowedGitRoot = normalizedPath(allowedGitRoot, "allowedGitRoot");
    this.authorityRoot = normalizedPath(authorityRoot, "authorityRoot");
    this.sourceWorkspaceRoot = normalizedPath(sourceWorkspaceRoot, "sourceWorkspaceRoot");
    this.workspaceRoot = normalizedPath(workspaceRoot, "workspaceRoot");
    ensureDisjoint(this.authorityRoot, this.sourceWorkspaceRoot, "authorityRoot", "sourceWorkspaceRoot");
    ensureDisjoint(this.authorityRoot, this.workspaceRoot, "authorityRoot", "workspaceRoot");
    ensureDisjoint(this.sourceWorkspaceRoot, this.workspaceRoot, "sourceWorkspaceRoot", "workspaceRoot");
    this.repositoryRef = safeRef(repositoryRef, "repositoryRef");
    if (typeof spawnImpl !== "function") throw new TypeError("spawnImpl must be a function");
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 5 * 60_000) throw new TypeError("timeoutMs is invalid");
    this.spawnImpl = spawnImpl;
    this.sourceEnv = env;
    this.env = buildEnvironment(env, this.gitCommand);
    this.timeoutMs = timeoutMs;
    if (!Number.isSafeInteger(maxBundleBytes) || maxBundleBytes < 1 || maxBundleBytes > DEFAULT_MAX_BUNDLE_BYTES) throw new TypeError("maxBundleBytes is invalid");
    this.maxBundleBytes = maxBundleBytes;
    this.repositoryPath = resolve(this.authorityRoot, "repositories", `${this.repositoryRef}.git`);
    this.mergeWorkspaceRoot = resolve(this.authorityRoot, "merge-workspaces");
    this.bundleRoot = resolve(this.authorityRoot, "git-bundles");
    this.ready = false;
  }

  toJSON() {
    return { repositoryRef: this.repositoryRef, ready: this.ready, objectFormat: this.objectFormat };
  }

  async initialize({ expectedInitialHead } = {}) {
    await mkdir(this.authorityRoot, { recursive: true, mode: 0o700 });
    await mkdir(this.workspaceRoot, { recursive: true, mode: 0o700 });
    const command = await realpath(this.gitCommand);
    const root = await realpath(this.allowedGitRoot);
    if (!isSameOrWithin(root, command)) throw new Error("Git executable is outside the fixed allowed runtime root");
    if (!/^git(?:\.exe)?$/iu.test(basename(command))) throw new Error("fixed Git executable name is invalid");
    this.gitCommand = command;
    this.env = buildEnvironment(this.sourceEnv, command);
    this.sourceWorkspaceRoot = await realpath(this.sourceWorkspaceRoot);
    this.authorityRoot = await realpath(this.authorityRoot);
    this.workspaceRoot = await realpath(this.workspaceRoot);
    ensureDisjoint(this.authorityRoot, this.sourceWorkspaceRoot, "authorityRoot", "sourceWorkspaceRoot");
    ensureDisjoint(this.authorityRoot, this.workspaceRoot, "authorityRoot", "workspaceRoot");
    ensureDisjoint(this.sourceWorkspaceRoot, this.workspaceRoot, "sourceWorkspaceRoot", "workspaceRoot");
    this.repositoryPath = resolve(this.authorityRoot, "repositories", `${this.repositoryRef}.git`);
    this.mergeWorkspaceRoot = resolve(this.authorityRoot, "merge-workspaces");
    this.bundleRoot = resolve(this.authorityRoot, "git-bundles");
    const topLevel = (await this.#git(["-C", this.sourceWorkspaceRoot, "rev-parse", "--show-toplevel"])).stdout.toString("utf8").trim();
    if (!samePath(resolve(topLevel), this.sourceWorkspaceRoot)) throw new Error("sourceWorkspaceRoot must be the exact Git worktree root");
    const sourceHead = commitRef((await this.#git(["-C", this.sourceWorkspaceRoot, "rev-parse", "HEAD"])).stdout.toString("utf8").trim(), "source HEAD");
    const objectFormat = (await this.#git(["-C", this.sourceWorkspaceRoot, "rev-parse", "--show-object-format"])).stdout.toString("utf8").trim();
    if (!new Set(["sha1", "sha256"]).has(objectFormat)) throw new Error("source Git object format is unsupported");
    this.objectFormat = objectFormat;
    if (expectedInitialHead !== undefined && sourceHead !== commitRef(expectedInitialHead, "expectedInitialHead")) throw new Error("source HEAD does not match the expected initial authority head");
    await mkdir(dirname(this.repositoryPath), { recursive: true, mode: 0o700 });
    await mkdir(this.mergeWorkspaceRoot, { recursive: true, mode: 0o700 });
    await mkdir(resolve(this.bundleRoot, "outgoing"), { recursive: true, mode: 0o700 });
    await mkdir(resolve(this.bundleRoot, "incoming"), { recursive: true, mode: 0o700 });
    await mkdir(this.workspaceRoot, { recursive: true, mode: 0o700 });
    if (!(await pathExists(this.repositoryPath))) {
      await this.#git(["init", "--bare", `--object-format=${objectFormat}`, this.repositoryPath]);
      await this.#git(["--git-dir", this.repositoryPath, "fetch", "--no-tags", "--no-write-fetch-head", this.sourceWorkspaceRoot, "HEAD:refs/heads/authority"]);
    } else {
      const bare = (await this.#git(["--git-dir", this.repositoryPath, "rev-parse", "--is-bare-repository"])).stdout.toString("utf8").trim();
      if (bare !== "true") throw new Error("authority repository is not bare");
      const authorityFormat = (await this.#git(["--git-dir", this.repositoryPath, "rev-parse", "--show-object-format"])).stdout.toString("utf8").trim();
      if (authorityFormat !== objectFormat) throw new Error("authority repository object format does not match the source");
    }
    const head = await this.head();
    await this.#git(["--git-dir", this.repositoryPath, "fsck", "--no-dangling", "--no-progress"]);
    this.ready = true;
    return immutable({ repositoryRef: this.repositoryRef, headCommit: head, sourceHead, objectFormat, sourceDirty: (await this.#git(["-C", this.sourceWorkspaceRoot, "status", "--porcelain=v1", "-z"], { maxOutputBytes: 4 * 1024 * 1024 })).stdout.length > 0 });
  }

  async head() {
    return commitRef((await this.#git(["--git-dir", this.repositoryPath, "rev-parse", "refs/heads/authority"])).stdout.toString("utf8").trim(), "authority HEAD");
  }

  async createTaskWorkspace({ workspaceRef, baseCommit } = {}) {
    const ref = safeRef(workspaceRef, "workspaceRef");
    const base = commitRef(baseCommit, "baseCommit");
    this.#requireReady();
    await this.#git(["--git-dir", this.repositoryPath, "cat-file", "-e", `${base}^{commit}`]);
    const workspacePath = this.#workspacePath(ref);
    if (await pathExists(workspacePath)) throw new Error("isolated task workspace path already exists");
    await this.#git(["--git-dir", this.repositoryPath, "worktree", "add", "--detach", workspacePath, base]);
    return immutable({ repositoryRef: this.repositoryRef, workspaceRef: ref, baseCommit: base, created: true });
  }

  async inspectChangeSet({ workspaceRef, expectedBaseCommit } = {}) {
    const ref = safeRef(workspaceRef, "workspaceRef");
    const expectedBase = commitRef(expectedBaseCommit, "expectedBaseCommit");
    this.#requireReady();
    const workspacePath = this.#workspacePath(ref);
    const status = await this.#git(["-C", workspacePath, "status", "--porcelain=v1", "-z"], { maxOutputBytes: 4 * 1024 * 1024 });
    if (status.stdout.length > 0) throw new Error("isolated task workspace must be clean before ChangeSet publication");
    const parents = (await this.#git(["-C", workspacePath, "rev-list", "--parents", "-n", "1", "HEAD"])).stdout.toString("utf8").trim().split(/\s+/u);
    if (parents.length !== 2) throw new Error("ChangeSet commit must have exactly one parent");
    const commit = commitRef(parents[0], "ChangeSet commit");
    const parentCommit = commitRef(parents[1], "ChangeSet parent");
    if (parentCommit !== expectedBase) throw new Error("ChangeSet parent does not equal the isolated workspace base");
    const files = parseNulPaths((await this.#git(["-C", workspacePath, "diff", "--name-only", "--no-renames", "-z", parentCommit, commit], { maxOutputBytes: 4 * 1024 * 1024 })).stdout);
    if (files.length === 0) throw new Error("ChangeSet commit has no changed files");
    const patch = (await this.#git(["-C", workspacePath, "diff", "--binary", "--full-index", "--no-ext-diff", "--no-renames", parentCommit, commit])).stdout;
    const tree = (await this.#git(["-C", workspacePath, "ls-tree", "-r", "-z", "--full-tree", commit])).stdout;
    return immutable({ repositoryRef: this.repositoryRef, workspaceRef: ref, commit, parentCommit, diffDigest: digest(patch), treeDigest: digest(tree), files });
  }

  async exportChangeSetBundle({ changeSet, workspaceRef, cas } = {}) {
    const declaration = normalizeChangeSetDeclaration(changeSet, this.repositoryRef);
    const ref = safeRef(workspaceRef, "workspaceRef");
    if (!(cas instanceof ArtifactContentAddressedStore)) throw new TypeError("cas must be an ArtifactContentAddressedStore");
    this.#requireReady();
    const inspected = await this.inspectChangeSet({ workspaceRef: ref, expectedBaseCommit: declaration.parentCommit });
    this.#assertChangeSetMatches(declaration, inspected);
    const anchorRef = `refs/harness/change-sets/${declaration.changeSetRef}`;
    await this.#bindExactRef(anchorRef, declaration.commit, "ChangeSet ref is already bound to another commit");
    const temporary = resolve(this.bundleRoot, "outgoing", `${declaration.changeSetRef}.${randomUUID()}.bundle.tmp`);
    try {
      await this.#git(["--git-dir", this.repositoryPath, "bundle", "create", temporary, anchorRef, `^${declaration.parentCommit}`]);
      const metadata = await hashFile(temporary, this.maxBundleBytes);
      const uploadRef = `upload_${createHash("sha256").update(`${this.repositoryRef}\u0000${declaration.changeSetRef}\u0000${metadata.digest}`).digest("base64url")}`;
      const begun = await cas.beginUpload({ uploadRef, expectedDigest: metadata.digest, expectedSize: metadata.size });
      if (begun.complete !== true) {
        const handle = await open(temporary, "r");
        try {
          let offset = begun.offset;
          while (offset < metadata.size) {
            const buffer = Buffer.alloc(Math.min(BUNDLE_CHUNK_BYTES, metadata.size - offset));
            const result = await handle.read(buffer, 0, buffer.length, offset);
            if (result.bytesRead < 1) throw new Error("Git bundle ended before its declared size");
            const chunk = buffer.subarray(0, result.bytesRead);
            const appended = await cas.appendChunk({ uploadRef, offset, bytes: chunk, chunkDigest: digest(chunk) });
            offset = appended.offset;
          }
        } finally { await handle.close(); }
        await cas.finalizeUpload(uploadRef);
      }
      return immutable({ repositoryRef: this.repositoryRef, changeSetRef: declaration.changeSetRef, commit: declaration.commit, bundleDigest: metadata.digest, bundleSize: metadata.size });
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  async importChangeSetBundle({ changeSet, bundleDigest, cas } = {}) {
    const declaration = normalizeChangeSetDeclaration(changeSet, this.repositoryRef);
    const expectedBundleDigest = digestRef(bundleDigest, "bundleDigest");
    if (!(cas instanceof ArtifactContentAddressedStore)) throw new TypeError("cas must be an ArtifactContentAddressedStore");
    this.#requireReady();
    const metadata = await cas.inspect(expectedBundleDigest);
    if (!metadata.present || metadata.size > this.maxBundleBytes) throw new Error("declared Git bundle is unavailable or exceeds its bound");
    const temporary = resolve(this.bundleRoot, "incoming", `${declaration.changeSetRef}.${randomUUID()}.bundle.tmp`);
    const handle = await open(temporary, "wx", 0o600);
    try {
      let offset = 0;
      while (offset < metadata.size) {
        const chunk = await cas.readChunk({ digest: expectedBundleDigest, offset, length: Math.min(BUNDLE_CHUNK_BYTES, metadata.size - offset) });
        if (chunk.bytes.length < 1) throw new Error("CAS bundle ended before its declared size");
        await handle.write(chunk.bytes, 0, chunk.bytes.length, offset);
        offset += chunk.bytes.length;
      }
      await handle.sync();
      await handle.close();
      const materialized = await hashFile(temporary, this.maxBundleBytes);
      if (materialized.digest !== expectedBundleDigest || materialized.size !== metadata.size) throw new Error("materialized Git bundle digest is invalid");
      await this.#git(["--git-dir", this.repositoryPath, "bundle", "verify", temporary]);
      const sourceRef = `refs/harness/change-sets/${declaration.changeSetRef}`;
      const quarantineRef = `refs/harness/quarantine/${declaration.changeSetRef}/${randomUUID().replaceAll("-", "")}`;
      try {
        await this.#git(["--git-dir", this.repositoryPath, "fetch", "--force", "--no-tags", "--no-write-fetch-head", temporary, `${sourceRef}:${quarantineRef}`]);
        const quarantined = commitRef((await this.#git(["--git-dir", this.repositoryPath, "rev-parse", quarantineRef])).stdout.toString("utf8").trim(), "quarantined ChangeSet");
        if (quarantined !== declaration.commit) throw new Error("Git bundle advertised commit does not match the ChangeSet");
        await this.#git(["--git-dir", this.repositoryPath, "fsck", "--strict", "--connectivity-only", "--no-progress", declaration.commit]);
        const inspected = await this.#inspectBareCommit(declaration.commit, declaration.parentCommit);
        this.#assertChangeSetMatches(declaration, inspected);
        await this.#bindExactRef(sourceRef, declaration.commit, "ChangeSet ref is already bound to another commit");
        return immutable({ ...declaration, bundleDigest: expectedBundleDigest, bundleSize: metadata.size, admitted: true });
      } finally {
        await this.#git(["--git-dir", this.repositoryPath, "update-ref", "-d", quarantineRef], { allowFailure: true });
      }
    } finally {
      await handle.close().catch(() => undefined);
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  async mergeChangeSets({ mergeGroupRef, baseHead, changeSets } = {}) {
    const groupRef = safeRef(mergeGroupRef, "mergeGroupRef");
    const base = commitRef(baseHead, "baseHead");
    this.#requireReady();
    if (!Array.isArray(changeSets) || changeSets.length < 1 || changeSets.length > 32) throw new TypeError("changeSets must contain from 1 through 32 entries");
    const commits = changeSets.map((entry, index) => commitRef(entry?.commit, `changeSets[${index}].commit`));
    if (new Set(commits).size !== commits.length) throw new Error("merge group contains duplicate commits");
    const mergePath = resolve(this.mergeWorkspaceRoot, groupRef);
    await this.#removeWorktree(mergePath);
    await this.#git(["--git-dir", this.repositoryPath, "worktree", "add", "--detach", mergePath, base]);
    try {
      for (const commit of commits) {
        const result = await this.#git(["-C", mergePath, "-c", "user.name=Harness Workspace Authority", "-c", "user.email=noreply@localhost", "cherry-pick", "--no-edit", "--allow-empty", commit], { allowFailure: true });
        if (!result.ok) {
          const conflicts = parseNulPaths((await this.#git(["-C", mergePath, "diff", "--name-only", "--diff-filter=U", "-z"], { allowFailure: true, maxOutputBytes: 4 * 1024 * 1024 })).stdout);
          await this.#git(["-C", mergePath, "cherry-pick", "--abort"], { allowFailure: true });
          return immutable({ repositoryRef: this.repositoryRef, mergeGroupRef: groupRef, merged: false, conflicts });
        }
      }
      const resultCommit = commitRef((await this.#git(["-C", mergePath, "rev-parse", "HEAD"])).stdout.toString("utf8").trim(), "merge result");
      const tree = (await this.#git(["-C", mergePath, "ls-tree", "-r", "-z", "--full-tree", resultCommit])).stdout;
      await this.#git(["--git-dir", this.repositoryPath, "update-ref", `refs/harness/merge-groups/${groupRef}`, resultCommit]);
      return immutable({ repositoryRef: this.repositoryRef, mergeGroupRef: groupRef, merged: true, resultCommit, treeDigest: digest(tree), conflicts: [] });
    } finally {
      await this.#removeWorktree(mergePath);
    }
  }

  async compareAndSwapHead({ mergeGroupRef, expectedHead, resultCommit } = {}) {
    const groupRef = safeRef(mergeGroupRef, "mergeGroupRef");
    const expected = commitRef(expectedHead, "expectedHead");
    const result = commitRef(resultCommit, "resultCommit");
    this.#requireReady();
    const anchored = commitRef((await this.#git(["--git-dir", this.repositoryPath, "rev-parse", `refs/harness/merge-groups/${groupRef}`])).stdout.toString("utf8").trim(), "anchored merge result");
    if (anchored !== result) throw new Error("result commit is not bound to the exact merge group");
    const current = await this.head();
    if (current !== expected) {
      const error = new Error("authority Git head changed before compare-and-swap");
      error.code = "AUTHORITY_HEAD_CONFLICT";
      throw error;
    }
    await this.#git(["--git-dir", this.repositoryPath, "cat-file", "-e", `${result}^{commit}`]);
    const updated = await this.#git(["--git-dir", this.repositoryPath, "update-ref", "refs/heads/authority", result, expected], { allowFailure: true });
    if (!updated.ok) {
      const error = new Error("authority Git head compare-and-swap failed");
      error.code = "AUTHORITY_HEAD_CONFLICT";
      throw error;
    }
    return immutable({ repositoryRef: this.repositoryRef, previousHead: expected, headCommit: result, advanced: true });
  }

  async removeTaskWorkspace(workspaceRef) {
    const ref = safeRef(workspaceRef, "workspaceRef");
    this.#requireReady();
    await this.#removeWorktree(this.#workspacePath(ref));
    return immutable({ repositoryRef: this.repositoryRef, workspaceRef: ref, removed: true });
  }

  async #bindExactRef(ref, commit, conflictMessage) {
    const existing = await this.#git(["--git-dir", this.repositoryPath, "rev-parse", "--verify", "--quiet", ref], { allowFailure: true });
    if (existing.ok) {
      if (commitRef(existing.stdout.toString("utf8").trim(), "existing Git ref") !== commit) throw new Error(conflictMessage);
      return;
    }
    const updated = await this.#git(["--git-dir", this.repositoryPath, "update-ref", ref, commit, "0".repeat(commit.length)], { allowFailure: true });
    if (updated.ok) return;
    const raced = await this.#git(["--git-dir", this.repositoryPath, "rev-parse", "--verify", "--quiet", ref], { allowFailure: true });
    if (!raced.ok || commitRef(raced.stdout.toString("utf8").trim(), "raced Git ref") !== commit) throw new Error(conflictMessage);
  }

  async #inspectBareCommit(commit, expectedParent) {
    const parents = (await this.#git(["--git-dir", this.repositoryPath, "rev-list", "--parents", "-n", "1", commit])).stdout.toString("utf8").trim().split(/\s+/u);
    if (parents.length !== 2) throw new Error("imported ChangeSet commit must have exactly one parent");
    const actualCommit = commitRef(parents[0], "imported ChangeSet commit");
    const parentCommit = commitRef(parents[1], "imported ChangeSet parent");
    if (parentCommit !== expectedParent) throw new Error("imported ChangeSet parent does not match its declaration");
    const files = parseNulPaths((await this.#git(["--git-dir", this.repositoryPath, "diff", "--name-only", "--no-renames", "-z", parentCommit, actualCommit], { maxOutputBytes: 4 * 1024 * 1024 })).stdout);
    if (files.length === 0) throw new Error("imported ChangeSet commit has no changed files");
    const patch = (await this.#git(["--git-dir", this.repositoryPath, "diff", "--binary", "--full-index", "--no-ext-diff", "--no-renames", parentCommit, actualCommit])).stdout;
    const tree = (await this.#git(["--git-dir", this.repositoryPath, "ls-tree", "-r", "-z", "--full-tree", actualCommit])).stdout;
    return { repositoryRef: this.repositoryRef, commit: actualCommit, parentCommit, diffDigest: digest(patch), treeDigest: digest(tree), files };
  }

  #assertChangeSetMatches(declaration, inspected) {
    if (declaration.commit !== inspected.commit || declaration.parentCommit !== inspected.parentCommit || declaration.diffDigest !== inspected.diffDigest || declaration.treeDigest !== inspected.treeDigest || JSON.stringify(declaration.files) !== JSON.stringify(inspected.files)) throw new Error("Git objects do not match the exact declared ChangeSet");
  }

  #workspacePath(ref) {
    const value = resolve(this.workspaceRoot, ref);
    if (!isSameOrWithin(this.workspaceRoot, value) || value === this.workspaceRoot) throw new Error("workspace reference escapes its root");
    return value;
  }

  async #removeWorktree(value) {
    if (!(await pathExists(value))) return;
    await this.#git(["--git-dir", this.repositoryPath, "worktree", "remove", "--force", value], { allowFailure: true });
    await rm(value, { recursive: true, force: true });
    await this.#git(["--git-dir", this.repositoryPath, "worktree", "prune", "--expire", "now"], { allowFailure: true });
  }

  #requireReady() {
    if (!this.ready) throw new Error("Git Workspace Adapter is not initialized");
  }

  #git(args, { allowFailure = false, maxOutputBytes = MAX_GIT_OUTPUT_BYTES } = {}) {
    if (!Array.isArray(args) || args.some((value) => typeof value !== "string" || value.includes("\0"))) return Promise.reject(new TypeError("Git arguments are invalid"));
    return new Promise((resolvePromise, rejectPromise) => {
      let child;
      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      let bytes = 0;
      let settled = false;
      let timer;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const output = Object.freeze({ ok: result.ok, code: result.code, stdout, stderr });
        if (result.ok || allowFailure) resolvePromise(output);
        else {
          const error = new Error(`bounded Git operation failed (${result.reason})`);
          error.code = "GIT_OPERATION_FAILED";
          rejectPromise(error);
        }
      };
      const append = (target, chunk) => {
        const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += value.length;
        if (bytes > maxOutputBytes) { child?.kill?.(); finish({ ok: false, code: null, reason: "output-limit" }); return; }
        if (target === "stdout") stdout = Buffer.concat([stdout, value]);
        else stderr = Buffer.concat([stderr, value]);
      };
      try {
        child = this.spawnImpl(this.gitCommand, args, { cwd: this.authorityRoot, env: this.env, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      } catch { finish({ ok: false, code: null, reason: "spawn" }); return; }
      child.stdout?.on("data", (chunk) => append("stdout", chunk));
      child.stderr?.on("data", (chunk) => append("stderr", chunk));
      child.once("error", () => finish({ ok: false, code: null, reason: "spawn" }));
      child.once("close", (code) => finish({ ok: code === 0, code: Number.isInteger(code) ? code : null, reason: code === 0 ? "ok" : "exit" }));
      timer = setTimeout(() => { child?.kill?.(); finish({ ok: false, code: null, reason: "timeout" }); }, this.timeoutMs);
      timer.unref?.();
    });
  }
}

export {
  BUNDLE_CHUNK_BYTES,
  COMMIT_REF,
  DEFAULT_GIT_TIMEOUT_MS,
  DEFAULT_MAX_BUNDLE_BYTES,
  MAX_GIT_OUTPUT_BYTES,
};
