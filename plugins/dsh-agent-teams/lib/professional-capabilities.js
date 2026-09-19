import { createHash } from "node:crypto";

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const HASH = /^[a-f0-9]{64}$/u;
const keys = (value, allowed) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every((key) => allowed.includes(key));
export function normalizeRequiredSkills(input = []) {
  if (!Array.isArray(input) || input.length > 8 || input.some((name) => typeof name !== "string" || name.length > 128 || !NAME.test(name))) throw new TypeError("required_skills requires at most eight exact kebab-case skill names");
  return [...new Set(input)];
}
export function validateSkillBindings(bindings) {
  if (!Array.isArray(bindings) || bindings.length > 8) throw new TypeError("invalid skill bindings");
  for (const item of bindings) {
    if (!keys(item, ["name", "status", "observedAt", "evidence"]) || !NAME.test(item.name) || !["missing", "bound", "loaded"].includes(item.status) || !Number.isFinite(Date.parse(item.observedAt))) throw new TypeError("invalid skill binding");
    if (item.evidence !== undefined) {
      const e = item.evidence;
      if (!keys(e, ["source", "loadedAt", "contentHash", "claimId", "leaseEpoch", "provider", "origin"]) || e.source !== "skill_tool" || !HASH.test(e.contentHash) || !Number.isFinite(Date.parse(e.loadedAt)) || typeof e.claimId !== "string" || !Number.isSafeInteger(e.leaseEpoch) || e.leaseEpoch < 0) throw new TypeError("invalid skill evidence");
      for (const label of [e.provider, e.origin]) if (label !== undefined && (typeof label !== "string" || label.length === 0 || label.length > 128 || /[\u0000-\u001f]/u.test(label))) throw new TypeError("invalid skill source label");
    }
    if ((item.status === "loaded") !== (item.evidence !== undefined)) throw new TypeError("loaded skill requires actual tool evidence");
  }
}
function registry(ctx) { return typeof ctx?.get === "function" ? ctx.get("skills") : ctx?.skills; }
// Uses the exact existing scoped registry/provider path, never a second directory
// search or a model-supplied catalog. Lookup does not claim model loading.
export async function resolveSkillBindings(ctx, agent, task) {
  const names = normalizeRequiredSkills(task.requiredSkills);
  const observedAt = new Date().toISOString();
  let catalog = [];
  try {
    const skills = registry(ctx);
    if (typeof skills?.snapshot === "function" && ctx?.tools?.get?.("skill", agent) !== undefined) {
      const snapshot = await skills.snapshot({ cwd: agent.session.header.cwd, scope: agent, signal: AbortSignal.timeout(5000) });
      if (snapshot.complete) catalog = snapshot.skills;
    }
  } catch { /* Fail visibly closed, without blocking general work. */ }
  return names.map((name) => ({ name, status: catalog.some((skill) => skill.name === name && skill.invocation?.modelInvocable === true) ? "bound" : "missing", observedAt }));
}
export function projectProfessionalCapabilities(task) {
  const required = normalizeRequiredSkills(task.requiredSkills);
  const bindings = task.skillBindings ?? [];
  const skills = required.map((name) => {
    const item = bindings.find((row) => row.name === name);
    const e = item?.evidence;
    const current = e !== undefined && e.claimId === task.claimId && e.leaseEpoch === task.leaseEpoch && Date.parse(e.loadedAt) >= Date.parse(task.claimedAt ?? "");
    return { name, status: item?.status === "loaded" ? current ? "loaded" : "bound" : item?.status ?? "bound", ...(current ? { evidence: { source: e.source, loadedAt: e.loadedAt, contentHash: e.contentHash, ...(e.provider === undefined ? {} : { provider: e.provider }), ...(e.origin === undefined ? {} : { origin: e.origin }) } } : {}) };
  });
  return {
    mode: task.professionalContractVersion === undefined && required.length === 0 ? "legacy" : required.length === 0 ? "general" : skills.some((skill) => skill.status === "missing") ? "missing_skills" : "specialized",
    skills,
    limitations: ["Skill loading is not professional certification or a quality pass.", ...(required.some((name) => !bindings.some((item) => item.name === name)) ? ["Skill names are bound requirements; availability is checked in the actual worker scope at claim."] : []), ...(required.length > 0 && skills.some((skill) => skill.status !== "loaded") ? ["Required skills without current successful tool evidence are not marked loaded."] : [])],
  };
}
// Invoked only by the live Host tools/result event. Historical session seeds and
// model-provided tool-result text are intentionally not accepted as evidence.
export async function observeSuccessfulSkill(ctx, exec, result, task) {
  if (exec?.name !== "skill" || result?.isError !== false || exec.signal?.aborted || exec.agent?.id !== task.assigneeSessionId || task.state !== "in_progress") return undefined;
  const skillName = exec.arguments?.name;
  if (!normalizeRequiredSkills(task.requiredSkills).includes(skillName)) return undefined;
  const value = result.value;
  if (!keys(value, ["name", "provider", "resourceBase", "content"]) || value.name !== skillName || typeof value.content !== "string" || value.content.length > 262144 || typeof value.provider !== "string") return undefined;
  // Scope-shadowed tools cannot impersonate the Host's loader registration.
  const hostTool = ctx.tools?.get?.("skill");
  if (hostTool === undefined || ctx.tools.get("skill", exec.agent) !== hostTool) return undefined;
  const skills = registry(ctx);
  if (typeof skills?.get !== "function") return undefined;
  let definition;
  try { definition = await skills.get(skillName, { cwd: exec.agent.session.header.cwd, scope: exec.agent, signal: AbortSignal.timeout(5000) }); } catch { return undefined; }
  if (definition?.invocation?.modelInvocable !== true || definition.name !== value.name || definition.provider !== value.provider || definition.content !== value.content || JSON.stringify(definition.resourceBase) !== JSON.stringify(value.resourceBase)) return undefined;
  const loadedAt = new Date().toISOString();
  const labels = {};
  for (const [key, label] of [["provider", definition.provider], ["origin", definition.source]]) if (typeof label === "string" && label.length > 0 && label.length <= 128 && !/[\u0000-\u001f]/u.test(label)) labels[key] = label;
  return { name: skillName, status: "loaded", observedAt: loadedAt, evidence: { source: "skill_tool", ...labels, loadedAt, contentHash: createHash("sha256").update(value.content).digest("hex"), claimId: task.claimId, leaseEpoch: task.leaseEpoch } };
}
