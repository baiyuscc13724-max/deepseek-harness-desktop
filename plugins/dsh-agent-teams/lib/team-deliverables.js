import { createHash } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep, win32 } from "node:path";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/u;
function fail(message, code = "AGENT_TEAMS_DELIVERY_REQUIRED") { const error = new TypeError(message); error.code = code; throw error; }
function object(value, fields, field) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !fields.includes(key))) fail(`${field} contains unsupported fields`);
}
function text(value, max, field) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) fail(`${field} must be bounded non-empty text`);
  return value.trim();
}
function list(value, max, field, map, min = 0) {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(`${field} requires ${min} through ${max} items`);
  return value.map(map);
}
export function normalizeAcceptanceCriteria(input = []) {
  return [...new Set(list(input, 12, "acceptance_criteria", (value) => text(value, 1000, "criterion")))];
}
function criteria(input) {
  const rows = list(input, 12, "criteria", (row) => { object(row, ["criterion", "evidence"], "criterion"); return { criterion: text(row.criterion, 1000, "criterion"), evidence: text(row.evidence, 2000, "evidence") }; }, 1);
  if (new Set(rows.map((row) => row.criterion)).size !== rows.length) fail("duplicate acceptance criterion");
  return rows;
}
function limitations(input = []) { return list(input, 12, "limitations", (value) => text(value, 1000, "limitation")); }
function artifactPath(input) {
  const path = text(input, 1024, "artifact.path");
  const segments = path.replaceAll("\\", "/").split("/");
  if (isAbsolute(path) || win32.isAbsolute(path) || path.includes(":") || segments.some((part) => !part || part === "." || part === ".." || /[. ]$/u.test(part) || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/iu.test(part)) || segments.some((part) => [".git", ".dsh", ".agents", "node_modules"].includes(part.toLowerCase()))) fail("artifact path must be an ordinary workspace-relative file", "AGENT_TEAMS_ARTIFACT_PATH_INVALID");
  return segments.join("/");
}
export function normalizeDeliveryInput(input) {
  object(input, ["summary", "content", "artifacts", "criteria", "limitations"], "delivery");
  const content = input.content === undefined ? undefined : text(input.content, 16000, "inline content");
  const artifacts = list(input.artifacts ?? [], 16, "artifacts", (row) => { object(row, ["path"], "artifact"); return { path: artifactPath(row.path) }; });
  if (artifacts.length === 0 && content === undefined) fail("provide non-empty inline content or file artifacts");
  if (new Set(artifacts.map((item) => item.path.toLowerCase())).size !== artifacts.length) fail("duplicate artifact path");
  return { summary: text(input.summary, 4000, "summary"), ...(content === undefined ? {} : { content }), artifacts, criteria: criteria(input.criteria), limitations: limitations(input.limitations) };
}
function requireCoverage(rows, required) {
  for (const criterion of normalizeAcceptanceCriteria(required)) if (!rows.some((row) => row.criterion === criterion)) fail("delivery/review omits a task acceptance criterion");
}
async function snapshotFile(workspace, path) {
  if (typeof workspace !== "string" || !isAbsolute(workspace)) fail("exact Host workspace is unavailable", "AGENT_TEAMS_PROJECT_SCOPE_UNKNOWN");
  const root = await realpath(workspace);
  const target = resolve(root, ...artifactPath(path).split("/"));
  const contained = (candidate) => { const child = relative(root, candidate); return child !== "" && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child); };
  if (!contained(target)) fail("artifact escapes workspace", "AGENT_TEAMS_ARTIFACT_PATH_INVALID");
  let current = root;
  for (const part of relative(root, target).split(sep)) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink()) fail("artifact symlink/junction is not accepted", "AGENT_TEAMS_ARTIFACT_PATH_INVALID");
  }
  if (!contained(await realpath(target))) fail("artifact escapes workspace", "AGENT_TEAMS_ARTIFACT_PATH_INVALID");
  if (!(await lstat(target)).isFile()) fail("artifact must be a regular file");
  const handle = await open(target, "r");
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > MAX_FILE_BYTES) fail("artifact must be a regular file no larger than 8 MiB");
    const buffer = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < buffer.length) { const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length); if (!bytesRead) break; length += bytesRead; }
    const after = await handle.stat();
    const linked = await lstat(target);
    if (length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || linked.isSymbolicLink() || linked.ino !== after.ino || linked.dev !== after.dev || !contained(await realpath(target))) fail("artifact changed while observed", "AGENT_TEAMS_ARTIFACT_CHANGED");
    return { path: artifactPath(path), sha256: createHash("sha256").update(buffer.subarray(0, length)).digest("hex"), bytes: length };
  } finally { await handle.close(); }
}
export async function bindTaskDelivery({ workspace, delivery, acceptanceCriteria = [], requireFiles = false }) {
  const normalized = normalizeDeliveryInput(delivery);
  if (requireFiles && normalized.artifacts.length === 0) fail("this task explicitly requires a real file artifact");
  requireCoverage(normalized.criteria, acceptanceCriteria);
  const artifacts = [];
  let total = 0;
  for (const item of normalized.artifacts) {
    let snapshot;
    try { snapshot = await snapshotFile(workspace, item.path); } catch (error) { if (error.code?.startsWith("AGENT_TEAMS_")) throw error; fail("artifact is missing or unreadable", "AGENT_TEAMS_ARTIFACT_UNAVAILABLE"); }
    total += snapshot.bytes;
    if (total > MAX_TOTAL_BYTES) fail("artifact set exceeds 32 MiB");
    artifacts.push(snapshot);
  }
  return { ...normalized, artifacts, ...(normalized.content === undefined ? {} : { contentHash: createHash("sha256").update(normalized.content).digest("hex") }) };
}
export function validateStoredDelivery(delivery) {
  object(delivery, ["summary", "content", "contentHash", "artifacts", "criteria", "limitations"], "stored delivery");
  if (delivery.content !== undefined && createHash("sha256").update(text(delivery.content, 16000, "inline content")).digest("hex") !== delivery.contentHash || delivery.content === undefined && delivery.contentHash !== undefined) fail("inline content hash is invalid");
  const artifacts = list(delivery.artifacts, 16, "artifacts", (item) => {
    object(item, ["path", "sha256", "bytes"], "stored artifact");
    if (!HASH.test(item.sha256) || !Number.isSafeInteger(item.bytes) || item.bytes < 0 || item.bytes > MAX_FILE_BYTES) fail("invalid stored artifact digest/size");
    return { path: artifactPath(item.path) };
  });
  if (delivery.artifacts.reduce((sum, item) => sum + item.bytes, 0) > MAX_TOTAL_BYTES) fail("stored artifact set exceeds bound");
  const { contentHash, ...input } = delivery;
  normalizeDeliveryInput({ ...input, artifacts });
}
export function normalizeReviewInput(review) {
  object(review, ["submission_id", "summary", "criteria", "limitations"], "review");
  return { submission_id: text(review.submission_id, 256, "submission_id"), summary: text(review.summary, 4000, "review summary"), criteria: criteria(review.criteria), limitations: limitations(review.limitations) };
}
export function validateStoredReview(review) { normalizeReviewInput(review); }
export async function reviewTaskDelivery({ workspace, submission, review, acceptanceCriteria = [] }) {
  const normalized = normalizeReviewInput(review);
  if (normalized.submission_id !== submission.id) fail("review targets an old or different submission", "AGENT_TEAMS_STALE_SUBMISSION");
  validateStoredDelivery(submission.delivery);
  requireCoverage(normalized.criteria, acceptanceCriteria.length ? acceptanceCriteria : submission.delivery.criteria.map((row) => row.criterion));
  const { contentHash, ...deliveryInput } = submission.delivery;
  const current = await bindTaskDelivery({ workspace, delivery: { ...deliveryInput, artifacts: submission.delivery.artifacts.map(({ path }) => ({ path })) }, acceptanceCriteria });
  if (JSON.stringify(current.artifacts) !== JSON.stringify(submission.delivery.artifacts)) fail("artifacts changed after submission; reject and resubmit", "AGENT_TEAMS_ARTIFACT_CHANGED");
  return normalized;
}
