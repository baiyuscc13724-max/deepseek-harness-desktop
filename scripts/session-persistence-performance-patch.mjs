import { createHash } from 'node:crypto'

const LIST_ARTIFACTS_START = '\tasync listArtifacts(signal) {'
const LIST_ARTIFACTS_END = '\n\t/** Atomically write the header line'
const LIST_ARTIFACTS_ORIGINAL_SHA256 = 'a731f7f81d25b7699c069ec211dc344a1664fdbfaf55bda75346b40c11b4ac20'
const LIST_ARTIFACTS_PATCH_MARKER = 'DSH_DESKTOP_BOUNDED_SESSION_LIST'

const LIST_ARTIFACTS_PATCHED = `\t${(async function listArtifacts(signal) {
  signal?.throwIfAborted();
  await this.ensureRootEncoding();
  signal?.throwIfAborted();
  const artifacts = [];
  const ids = /* @__PURE__ */ new Set();
  const sessionDirs = [];
  for (const project of await this.listProjectDirs(signal)) {
    signal?.throwIfAborted();
    sessionDirs.push(...await this.listSessionDirs(project, signal));
  }
  const inspectArtifact = async (dir) => {
    signal?.throwIfAborted();
    const opposite = join(dir, `session${logSuffix(this.oppositeCompression())}`);
    const oppositeExists = await this.exists(opposite);
    signal?.throwIfAborted();
    if (oppositeExists) throw this.encodingMismatch(opposite);
    const path = join(dir, `session${logSuffix(this.compression)}`);
    const pathExists = await this.exists(path);
    signal?.throwIfAborted();
    if (!pathExists) return;
    const first = this.compression === "zstd" ? await this.readFirstZstdLine(path, signal) : await this.readFirstLine(path, signal);
    signal?.throwIfAborted();
    if (first === void 0) return;
    const meta = parseHeaderMeta(first);
    if (meta === void 0) return;
    await this.assertStoredIdentity(path, meta, void 0, signal);
    signal?.throwIfAborted();
    return {
      header: meta,
      path
    };
  };
  /* DSH_DESKTOP_BOUNDED_SESSION_LIST: keep physical reads parallel but observations ordered. */
  const settled = new Array(sessionDirs.length);
  let next = 0;
  const launch = (index) => {
    settled[index] = inspectArtifact(sessionDirs[index]).then((value) => ({
      status: "fulfilled",
      value
    }), (reason) => ({
      status: "rejected",
      reason
    }));
  };
  const concurrency = Math.min(8, sessionDirs.length);
  while (next < concurrency) launch(next++);
  for (let index = 0; index < sessionDirs.length; index++) {
    const result = await settled[index];
    if (result.status === "rejected") {
      await Promise.all(settled.slice(index + 1).filter(Boolean));
      throw result.reason;
    }
    const artifact = result.value;
    if (artifact !== void 0) {
      const meta = artifact.header;
      if (ids.has(meta.id)) {
        await Promise.all(settled.slice(index + 1).filter(Boolean));
        throw new Error(`duplicate JSONL session id "${meta.id}" appears in multiple project directories`);
      }
      ids.add(meta.id);
      artifacts.push(artifact);
    }
    if (next < sessionDirs.length) launch(next++);
  }
  signal?.throwIfAborted();
  return artifacts;
}).toString().replace(/\r\n?/g, '\n').replace('async function listArtifacts', 'async listArtifacts')}`

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function patchSessionPersistenceListingSource(source) {
  const start = source.indexOf(LIST_ARTIFACTS_START)
  if (start === -1) throw new Error('Pinned DSH session persistence listArtifacts method is absent; refusing an unsafe performance patch.')
  const end = source.indexOf(LIST_ARTIFACTS_END, start)
  if (end === -1) throw new Error('Pinned DSH session persistence listArtifacts boundary changed; refusing an unsafe performance patch.')
  const current = source.slice(start, end)
  if (current === LIST_ARTIFACTS_PATCHED) return { source, changed: false }
  if (current.includes(LIST_ARTIFACTS_PATCH_MARKER)) {
    throw new Error('Installed DSH bounded session listing patch differs from the pinned implementation; refusing to overwrite it.')
  }
  if (sha256(current) !== LIST_ARTIFACTS_ORIGINAL_SHA256) {
    throw new Error('Pinned DSH session persistence listArtifacts implementation changed; refusing an unsafe performance patch.')
  }
  return {
    source: `${source.slice(0, start)}${LIST_ARTIFACTS_PATCHED}${source.slice(end)}`,
    changed: true
  }
}
