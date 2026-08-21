import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { QualityEvidenceAuthority, TRUST_RANK } from "./quality-evidence.js";

const ORCHESTRATOR_VERSION = 1;
const ORCHESTRATOR_HOST_STATE_VERSION = 1;
const MAX_HOST_RECORDS = 100_000;
const CAMPAIGN_PROFILES = new Set(["merge", "nightly", "release"]);
const ACTIVE_CAMPAIGN_STATES = new Set(["queued", "running"]);
const TERMINAL_JOB_STATES = new Set(["passed", "failed", "error", "canceled"]);
const INFRA_FAILURE_CODES = new Set(["RUNNER_LOST", "ENVIRONMENT_UNAVAILABLE", "ARTIFACT_FETCH_FAILED", "TIMEOUT", "CANCELED"]);
const DIGEST_REF = /^sha256:[a-f0-9]{64}$/u;
const COMMIT_REF = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const MAX_LEASE_MS = 30 * 60 * 1_000;
const DEFAULT_LEASE_MS = 5 * 60 * 1_000;
const MAX_TEMPLATE_TIMEOUT_MS = 24 * 60 * 60 * 1_000;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nonEmptyString(value, field, max = 2_000) {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) throw new TypeError(`${field} must be a non-empty string of at most ${max} characters`);
  return value.trim();
}
function safeInteger(value, field, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new TypeError(`${field} must be a safe integer from ${minimum} through ${maximum}`);
  return value;
}
function digestRef(value, field) {
  const ref = nonEmptyString(value, field, 80).toLowerCase();
  if (!DIGEST_REF.test(ref)) throw new TypeError(`${field} must be a sha256 digest`);
  return ref;
}
function assertAllowedKeys(value, allowed, field) {
  const extras = Object.keys(value).filter((key) => !allowed.has(key));
  if (extras.length > 0) throw new TypeError(`${field} contains unsupported fields: ${extras.join(", ")}`);
}
function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}
function losslessJson(value, field) {
  let encoded;
  try { encoded = JSON.stringify(value); } catch (error) { throw new TypeError(`${field} must be lossless JSON: ${String(error)}`); }
  if (encoded === undefined) throw new TypeError(`${field} must be lossless JSON`);
  const decoded = JSON.parse(encoded);
  if (canonicalJson(decoded) !== canonicalJson(value)) throw new TypeError(`${field} must be lossless JSON`);
  return decoded;
}
function hostStateMac(value, secret) {
  const body = { ...value };
  delete body.stateMac;
  return createHmac("sha256", secret).update(canonicalJson(body)).digest("base64url");
}
function verifyHostStateMac(value, secret) {
  if (typeof value.stateMac !== "string") throw new Error("Test Orchestrator Host state authentication failed");
  const expected = Buffer.from(hostStateMac(value, secret));
  const supplied = Buffer.from(value.stateMac);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new Error("Test Orchestrator Host state authentication failed");
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
function normalizeBinding(value) {
  if (!isRecord(value)) throw new TypeError("binding must be an object");
  const resultCommit = nonEmptyString(value.resultCommit, "binding.resultCommit", 64).toLowerCase();
  const baseHead = nonEmptyString(value.baseHead, "binding.baseHead", 64).toLowerCase();
  if (!COMMIT_REF.test(resultCommit) || !COMMIT_REF.test(baseHead)) throw new TypeError("binding commit references are invalid");
  return immutable({
    projectRef: nonEmptyString(value.projectRef, "binding.projectRef", 128),
    repositoryRef: nonEmptyString(value.repositoryRef, "binding.repositoryRef", 128),
    authorityEpoch: safeInteger(value.authorityEpoch, "binding.authorityEpoch", 1),
    mergeGroupRef: nonEmptyString(value.mergeGroupRef, "binding.mergeGroupRef", 128),
    baseHead,
    resultCommit,
    artifactSetRef: nonEmptyString(value.artifactSetRef, "binding.artifactSetRef", 128),
    manifestDigest: digestRef(value.manifestDigest, "binding.manifestDigest"),
  });
}
function publicJob(job) {
  return immutable({ jobRef: job.jobRef, campaignRef: job.campaignRef, planRef: job.planRef, suiteRef: job.suiteRef, templateRef: job.templateRef, state: job.state, attempts: job.attempts, maxAttempts: job.maxAttempts, ...(job.runnerRef === undefined ? {} : { runnerRef: job.runnerRef }), ...(job.attestationRefs.length === 0 ? {} : { attestationRefs: [...job.attestationRefs] }), createdAt: job.createdAt, updatedAt: job.updatedAt });
}
function publicCampaign(campaign, jobs) {
  return immutable({ version: ORCHESTRATOR_VERSION, campaignRef: campaign.campaignRef, projectRef: campaign.binding.projectRef, repositoryRef: campaign.binding.repositoryRef, profile: campaign.profile, planRef: campaign.planRef, binding: campaign.binding, state: campaign.state, jobCounts: jobs.reduce((result, job) => ({ ...result, [job.state]: (result[job.state] ?? 0) + 1 }), {}), ...(campaign.gateReceipt === undefined ? {} : { gateReceipt: campaign.gateReceipt }), createdAt: campaign.createdAt, updatedAt: campaign.updatedAt });
}

export class TestOrchestrator {
  constructor({ qualityAuthority, secret, now = Date.now } = {}) {
    if (!(qualityAuthority instanceof QualityEvidenceAuthority)) throw new TypeError("qualityAuthority must be a QualityEvidenceAuthority");
    this.qualityAuthority = qualityAuthority;
    this.projectRef = qualityAuthority.projectRef;
    this.repositoryRef = qualityAuthority.repositoryRef;
    this.secret = nonEmptyString(secret, "secret", 512);
    if (this.secret.length < 24) throw new TypeError("secret must contain at least 24 characters");
    if (typeof now !== "function") throw new TypeError("now must be a function");
    this.now = now;
    this.templates = new Map();
    this.campaigns = new Map();
    this.jobs = new Map();
    this.projectPaused = false;
    this.pauseEpoch = 0;
    this.leaseCounter = 0;
  }

  static restore(hostState, { now = Date.now } = {}) {
    const state = losslessJson(hostState, "Test Orchestrator Host state");
    if (!isRecord(state) || state.version !== ORCHESTRATOR_HOST_STATE_VERSION || state.stateKind !== "test-orchestrator-host") throw new TypeError("Test Orchestrator Host state version or kind is unsupported");
    const secret = nonEmptyString(state.secret, "state.secret", 512);
    verifyHostStateMac(state, secret);
    if (!Array.isArray(state.templates) || !Array.isArray(state.campaigns) || !Array.isArray(state.jobs) || state.templates.length + state.campaigns.length + state.jobs.length > MAX_HOST_RECORDS) throw new TypeError("Test Orchestrator Host state collections are invalid");
    const qualityAuthority = QualityEvidenceAuthority.restore(state.qualityState, { now });
    if (qualityAuthority.projectRef !== state.projectRef || qualityAuthority.repositoryRef !== state.repositoryRef) throw new Error("Test Orchestrator Quality scope is invalid");
    const orchestrator = new TestOrchestrator({ qualityAuthority, secret, now });
    if (typeof state.projectPaused !== "boolean") throw new TypeError("Test Orchestrator pause state is invalid");
    orchestrator.projectPaused = state.projectPaused;
    orchestrator.pauseEpoch = safeInteger(state.pauseEpoch, "state.pauseEpoch");
    orchestrator.leaseCounter = safeInteger(state.leaseCounter, "state.leaseCounter");
    for (const raw of state.templates) {
      if (!isRecord(raw) || !Array.isArray(raw.allowedProfiles)) throw new TypeError("persisted test template is invalid");
      const body = { version: ORCHESTRATOR_VERSION, projectRef: orchestrator.projectRef, repositoryRef: orchestrator.repositoryRef, suiteRef: nonEmptyString(raw.suiteRef, "template.suiteRef", 128), templateDigest: digestRef(raw.templateDigest, "template.templateDigest"), environmentDigest: digestRef(raw.environmentDigest, "template.environmentDigest"), templateVersion: nonEmptyString(raw.templateVersion, "template.templateVersion", 64), allowedProfiles: [...new Set(raw.allowedProfiles.map((profile) => nonEmptyString(profile, "template.allowedProfile", 32)))].sort(), timeoutMs: safeInteger(raw.timeoutMs, "template.timeoutMs", 1_000, MAX_TEMPLATE_TIMEOUT_MS), maxAttempts: safeInteger(raw.maxAttempts, "template.maxAttempts", 1, 5) };
      if (body.allowedProfiles.length < 1 || body.allowedProfiles.some((profile) => !CAMPAIGN_PROFILES.has(profile))) throw new Error("persisted test template profiles are invalid");
      const templateRef = nonEmptyString(raw.templateRef, "template.templateRef", 128);
      if (templateRef !== shaRef("template", Buffer.from(canonicalJson(body))) || orchestrator.templates.has(templateRef) || !new Set(["active", "disabled"]).has(raw.status)) throw new Error("persisted test template binding is invalid");
      orchestrator.templates.set(templateRef, immutable({ ...body, templateRef, status: raw.status, createdAt: safeInteger(raw.createdAt, "template.createdAt"), ...(raw.status === "disabled" ? { disabledAt: safeInteger(raw.disabledAt, "template.disabledAt") } : {}) }));
    }
    for (const raw of state.campaigns) {
      if (!isRecord(raw) || !Array.isArray(raw.templateRefs) || !Array.isArray(raw.jobRefs)) throw new TypeError("persisted test campaign is invalid");
      const profile = nonEmptyString(raw.profile, "campaign.profile", 32);
      if (!CAMPAIGN_PROFILES.has(profile)) throw new Error("persisted test campaign profile is invalid");
      const binding = normalizeBinding(raw.binding);
      const plan = qualityAuthority.getPlan(raw.planRef);
      const templateRefs = [...new Set(raw.templateRefs.map((ref) => nonEmptyString(ref, "campaign.templateRef", 128)))].sort();
      if (templateRefs.length !== raw.templateRefs.length || templateRefs.some((ref) => !orchestrator.templates.has(ref))) throw new Error("persisted test campaign templates are invalid");
      const body = { version: ORCHESTRATOR_VERSION, projectRef: orchestrator.projectRef, repositoryRef: orchestrator.repositoryRef, profile, planRef: plan.planRef, binding, templateRefs };
      const campaignRef = nonEmptyString(raw.campaignRef, "campaign.campaignRef", 128);
      if (campaignRef !== shaRef("campaign", Buffer.from(canonicalJson(body))) || orchestrator.campaigns.has(campaignRef) || !new Set(["queued", "running", "passed", "failed", "canceled"]).has(raw.state)) throw new Error("persisted test campaign binding is invalid");
      let gateReceipt;
      if (raw.gateReceipt !== undefined) {
        gateReceipt = qualityAuthority.receipts.get(nonEmptyString(raw.gateReceipt.gateReceiptRef, "campaign.gateReceiptRef", 128));
        if (gateReceipt === undefined || canonicalJson(gateReceipt) !== canonicalJson(raw.gateReceipt)) throw new Error("persisted test campaign Gate Receipt is invalid");
      }
      orchestrator.campaigns.set(campaignRef, { ...body, campaignRef, state: raw.state, jobRefs: [...raw.jobRefs], ...(gateReceipt === undefined ? {} : { gateReceipt }), createdAt: safeInteger(raw.createdAt, "campaign.createdAt"), updatedAt: safeInteger(raw.updatedAt, "campaign.updatedAt") });
    }
    for (const raw of state.jobs) {
      if (!isRecord(raw) || !Array.isArray(raw.attestationRefs)) throw new TypeError("persisted test job is invalid");
      const campaign = orchestrator.campaigns.get(raw.campaignRef);
      const template = orchestrator.templates.get(raw.templateRef);
      if (campaign === undefined || template === undefined || raw.planRef !== campaign.planRef || canonicalJson(raw.binding) !== canonicalJson(campaign.binding)) throw new Error("persisted test job scope is invalid");
      const jobBody = { version: ORCHESTRATOR_VERSION, campaignRef: campaign.campaignRef, planRef: campaign.planRef, suiteRef: nonEmptyString(raw.suiteRef, "job.suiteRef", 128), templateRef: template.templateRef, binding: campaign.binding };
      const jobRef = nonEmptyString(raw.jobRef, "job.jobRef", 128);
      if (jobRef !== shaRef("testjob", Buffer.from(canonicalJson(jobBody))) || orchestrator.jobs.has(jobRef) || template.suiteRef !== jobBody.suiteRef || !new Set(["queued", "running", "cancel_requested", "paused", "passed", "failed", "error", "canceled"]).has(raw.state)) throw new Error("persisted test job binding is invalid");
      const attestationRefs = raw.attestationRefs.map((ref) => nonEmptyString(ref, "job.attestationRef", 128));
      if (new Set(attestationRefs).size !== attestationRefs.length || attestationRefs.some((ref) => qualityAuthority.getAttestation(ref) === undefined)) throw new Error("persisted test job evidence is invalid");
      const job = { ...jobBody, jobRef, state: raw.state, attempts: safeInteger(raw.attempts, "job.attempts"), maxAttempts: safeInteger(raw.maxAttempts, "job.maxAttempts", 1, 5), attestationRefs, createdAt: safeInteger(raw.createdAt, "job.createdAt"), updatedAt: safeInteger(raw.updatedAt, "job.updatedAt") };
      if (job.attempts > job.maxAttempts || job.maxAttempts !== template.maxAttempts) throw new Error("persisted test job attempt binding is invalid");
      if (new Set(["running", "cancel_requested"]).has(job.state)) {
        const runner = qualityAuthority.getRunner(raw.runnerRef);
        job.runnerRef = runner.runnerRef;
        job.runnerKeyId = nonEmptyString(raw.runnerKeyId, "job.runnerKeyId", 128);
        if (job.runnerKeyId !== runner.runnerKeyId) throw new Error("persisted test job runner binding is invalid");
        job.leaseToken = nonEmptyString(raw.leaseToken, "job.leaseToken", 128);
        job.leaseExpiresAt = safeInteger(raw.leaseExpiresAt, "job.leaseExpiresAt");
        job.attemptStartedAt = safeInteger(raw.attemptStartedAt, "job.attemptStartedAt");
        if (raw.cancelReason !== undefined) job.cancelReason = nonEmptyString(raw.cancelReason, "job.cancelReason", 64);
      }
      if (raw.lastInfrastructureFailure !== undefined) {
        job.lastInfrastructureFailure = nonEmptyString(raw.lastInfrastructureFailure, "job.lastInfrastructureFailure", 64);
        if (!INFRA_FAILURE_CODES.has(job.lastInfrastructureFailure)) throw new Error("persisted test job failure code is invalid");
      }
      orchestrator.jobs.set(jobRef, job);
    }
    for (const campaign of orchestrator.campaigns.values()) {
      if (new Set(campaign.jobRefs).size !== campaign.jobRefs.length || campaign.jobRefs.some((ref) => orchestrator.jobs.get(ref)?.campaignRef !== campaign.campaignRef)) throw new Error("persisted test campaign job list is invalid");
    }
    if ([...orchestrator.jobs.values()].some((job) => !orchestrator.campaigns.get(job.campaignRef).jobRefs.includes(job.jobRef))) throw new Error("persisted test job is orphaned");
    orchestrator.#expire();
    return orchestrator;
  }

  exportHostState() {
    const state = {
      version: ORCHESTRATOR_HOST_STATE_VERSION,
      stateKind: "test-orchestrator-host",
      projectRef: this.projectRef,
      repositoryRef: this.repositoryRef,
      secret: this.secret,
      projectPaused: this.projectPaused,
      pauseEpoch: this.pauseEpoch,
      leaseCounter: this.leaseCounter,
      qualityState: this.qualityAuthority.exportHostState(),
      templates: [...this.templates.values()].map((template) => losslessJson(template, "test template")),
      campaigns: [...this.campaigns.values()].map((campaign) => losslessJson(campaign, "test campaign")),
      jobs: [...this.jobs.values()].map((job) => losslessJson(job, "test job")),
    };
    return immutable({ ...state, stateMac: hostStateMac(state, this.secret) });
  }

  toJSON() {
    return { version: ORCHESTRATOR_VERSION, projectRef: this.projectRef, repositoryRef: this.repositoryRef, projectPaused: this.projectPaused, pauseEpoch: this.pauseEpoch, templateCount: this.templates.size, activeCampaignCount: [...this.campaigns.values()].filter((campaign) => ACTIVE_CAMPAIGN_STATES.has(campaign.state)).length, queuedJobCount: [...this.jobs.values()].filter((job) => job.state === "queued").length, runningJobCount: [...this.jobs.values()].filter((job) => new Set(["running", "cancel_requested"]).has(job.state)).length };
  }

  registerTemplate(input = {}) {
    if (!isRecord(input)) throw new TypeError("template must be an object");
    assertAllowedKeys(input, new Set(["suiteRef", "templateDigest", "environmentDigest", "version", "allowedProfiles", "timeoutMs", "maxAttempts"]), "template");
    const { suiteRef, templateDigest, environmentDigest, version, allowedProfiles = ["merge", "nightly", "release"], timeoutMs, maxAttempts = 2 } = input;
    const suite = nonEmptyString(suiteRef, "suiteRef", 128);
    if (!Array.isArray(allowedProfiles)) throw new TypeError("allowedProfiles must be an array");
    const profiles = [...new Set(allowedProfiles.map((profile, index) => {
      const normalized = nonEmptyString(profile, `allowedProfiles[${index}]`, 32);
      if (!CAMPAIGN_PROFILES.has(normalized)) throw new TypeError(`allowed profile ${normalized} is unsupported`);
      return normalized;
    }))].sort();
    if (profiles.length < 1) throw new TypeError("allowedProfiles must not be empty");
    const body = { version: ORCHESTRATOR_VERSION, projectRef: this.projectRef, repositoryRef: this.repositoryRef, suiteRef: suite, templateDigest: digestRef(templateDigest, "templateDigest"), environmentDigest: digestRef(environmentDigest, "environmentDigest"), templateVersion: nonEmptyString(version, "version", 64), allowedProfiles: profiles, timeoutMs: safeInteger(timeoutMs, "timeoutMs", 1_000, MAX_TEMPLATE_TIMEOUT_MS), maxAttempts: safeInteger(maxAttempts, "maxAttempts", 1, 5) };
    const templateRef = shaRef("template", Buffer.from(canonicalJson(body)));
    const existing = this.templates.get(templateRef);
    if (existing !== undefined) return existing;
    const template = immutable({ ...body, templateRef, status: "active", createdAt: this.now() });
    this.templates.set(templateRef, template);
    return template;
  }

  disableTemplate(templateRef) {
    const current = this.#template(templateRef);
    if (current.status === "disabled") return current;
    const replacement = immutable({ ...current, status: "disabled", disabledAt: this.now() });
    this.templates.set(current.templateRef, replacement);
    return replacement;
  }

  startCampaign({ profile, planRef, binding, templateRefs } = {}) {
    if (this.projectPaused) throw new Error("project test orchestration is paused");
    const normalizedProfile = nonEmptyString(profile, "profile", 32);
    if (!CAMPAIGN_PROFILES.has(normalizedProfile)) throw new TypeError("profile must be merge, nightly, or release");
    const plan = this.qualityAuthority.getPlan(planRef);
    const normalizedBinding = normalizeBinding(binding);
    if (normalizedBinding.projectRef !== this.projectRef || normalizedBinding.repositoryRef !== this.repositoryRef) throw new Error("campaign binding is outside this project");
    if (!Array.isArray(templateRefs)) throw new TypeError("templateRefs must be an array");
    const selectedSuites = normalizedProfile === "merge" ? plan.suites.filter((suite) => suite.required) : plan.suites;
    const selectedTemplates = templateRefs.map((ref) => this.#template(ref));
    if (selectedTemplates.length !== selectedSuites.length || new Set(selectedTemplates.map((template) => template.suiteRef)).size !== selectedSuites.length) throw new Error("campaign must bind exactly one template for every selected suite");
    for (const suite of selectedSuites) {
      const template = selectedTemplates.find((entry) => entry.suiteRef === suite.suiteRef);
      if (template === undefined || template.status !== "active" || !template.allowedProfiles.includes(normalizedProfile)) throw new Error(`suite ${suite.suiteRef} has no active template for ${normalizedProfile}`);
    }
    const body = { version: ORCHESTRATOR_VERSION, projectRef: this.projectRef, repositoryRef: this.repositoryRef, profile: normalizedProfile, planRef: plan.planRef, binding: normalizedBinding, templateRefs: selectedTemplates.map((template) => template.templateRef).sort() };
    const campaignRef = shaRef("campaign", Buffer.from(canonicalJson(body)));
    const existing = this.campaigns.get(campaignRef);
    if (existing !== undefined) return this.campaignStatus(campaignRef);
    const current = this.now();
    const campaign = { ...body, campaignRef, state: "queued", jobRefs: [], createdAt: current, updatedAt: current };
    for (const suite of selectedSuites) {
      const template = selectedTemplates.find((entry) => entry.suiteRef === suite.suiteRef);
      const jobBody = { version: ORCHESTRATOR_VERSION, campaignRef, planRef: plan.planRef, suiteRef: suite.suiteRef, templateRef: template.templateRef, binding: normalizedBinding };
      const jobRef = shaRef("testjob", Buffer.from(canonicalJson(jobBody)));
      const job = { ...jobBody, jobRef, state: "queued", attempts: 0, maxAttempts: template.maxAttempts, attestationRefs: [], createdAt: current, updatedAt: current };
      this.jobs.set(jobRef, job);
      campaign.jobRefs.push(jobRef);
    }
    this.campaigns.set(campaignRef, campaign);
    return this.campaignStatus(campaignRef);
  }

  claimJob({ runnerRef, leaseMs = DEFAULT_LEASE_MS } = {}) {
    this.#expire();
    if (this.projectPaused) return undefined;
    const runner = this.qualityAuthority.getRunner(runnerRef);
    if (runner.status !== "active") throw new Error("runner is not active");
    const duration = safeInteger(leaseMs, "leaseMs", 1_000, MAX_LEASE_MS);
    const candidates = [...this.jobs.values()].filter((job) => {
      if (job.state !== "queued") return false;
      const campaign = this.campaigns.get(job.campaignRef);
      if (!ACTIVE_CAMPAIGN_STATES.has(campaign.state)) return false;
      const plan = this.qualityAuthority.getPlan(job.planRef);
      const suite = plan.suites.find((entry) => entry.suiteRef === job.suiteRef);
      const template = this.templates.get(job.templateRef);
      return template?.status === "active" && runner.capabilities.includes(job.suiteRef) && TRUST_RANK[runner.trust] >= TRUST_RANK[suite.minimumTrust];
    }).sort((left, right) => {
      const priority = { release: 0, merge: 1, nightly: 2 };
      return priority[this.campaigns.get(left.campaignRef).profile] - priority[this.campaigns.get(right.campaignRef).profile] || left.createdAt - right.createdAt || left.jobRef.localeCompare(right.jobRef);
    });
    const job = candidates[0];
    if (job === undefined) return undefined;
    const template = this.#template(job.templateRef);
    const current = this.now();
    job.attempts += 1;
    job.state = "running";
    job.runnerRef = runner.runnerRef;
    job.runnerKeyId = runner.runnerKeyId;
    job.attemptStartedAt = current;
    job.leaseExpiresAt = Math.min(current + duration, current + template.timeoutMs);
    job.leaseToken = opaqueRef("lease", this.secret, job.jobRef, runner.runnerRef, job.attempts, this.pauseEpoch, ++this.leaseCounter, randomBytes(16).toString("base64url"));
    job.updatedAt = current;
    const campaign = this.campaigns.get(job.campaignRef);
    campaign.state = "running";
    campaign.updatedAt = current;
    return immutable({ jobRef: job.jobRef, campaignRef: job.campaignRef, profile: campaign.profile, planRef: job.planRef, suiteRef: job.suiteRef, templateRef: template.templateRef, templateDigest: template.templateDigest, environmentDigest: template.environmentDigest, binding: job.binding, attempt: job.attempts, leaseToken: job.leaseToken, leaseExpiresAt: job.leaseExpiresAt, timeoutAt: job.attemptStartedAt + template.timeoutMs });
  }

  heartbeat({ jobRef, runnerRef, leaseToken, leaseMs = DEFAULT_LEASE_MS } = {}) {
    this.#expire();
    const job = this.#leasedJob(jobRef, runnerRef, leaseToken, new Set(["running", "cancel_requested"]));
    if (job.state === "cancel_requested") return immutable({ jobRef: job.jobRef, cancelRequested: true, leaseExpiresAt: job.leaseExpiresAt });
    const duration = safeInteger(leaseMs, "leaseMs", 1_000, MAX_LEASE_MS);
    const template = this.#template(job.templateRef);
    job.leaseExpiresAt = Math.min(this.now() + duration, job.attemptStartedAt + template.timeoutMs);
    job.updatedAt = this.now();
    return immutable({ jobRef: job.jobRef, cancelRequested: false, leaseExpiresAt: job.leaseExpiresAt });
  }

  completeJob({ jobRef, runnerRef, leaseToken, attestation, signature } = {}) {
    this.#expire();
    const job = this.#leasedJob(jobRef, runnerRef, leaseToken, new Set(["running"]));
    const template = this.#template(job.templateRef);
    if (!isRecord(attestation) || attestation.planRef !== job.planRef || attestation.suiteRef !== job.suiteRef || attestation.runnerRef !== job.runnerRef || attestation.runnerKeyId !== job.runnerKeyId || canonicalJson(attestation.binding) !== canonicalJson(job.binding) || attestation.environmentDigest !== template.environmentDigest || !Number.isSafeInteger(attestation.startedAt) || !Number.isSafeInteger(attestation.finishedAt) || attestation.startedAt < job.attemptStartedAt || attestation.finishedAt > job.attemptStartedAt + template.timeoutMs) throw new Error("attestation does not match the exact leased test job");
    const admitted = this.qualityAuthority.submitAttestation({ attestation, signature }).attestation;
    if (admitted.planRef !== job.planRef || admitted.suiteRef !== job.suiteRef || admitted.runnerRef !== job.runnerRef || admitted.runnerKeyId !== job.runnerKeyId || canonicalJson(admitted.binding) !== canonicalJson(job.binding) || admitted.environmentDigest !== template.environmentDigest) throw new Error("attestation does not match the exact leased test job");
    if (admitted.startedAt < job.attemptStartedAt || admitted.finishedAt > job.attemptStartedAt + template.timeoutMs) throw new Error("attestation time range is outside the leased attempt");
    job.attestationRefs.push(admitted.attestationRef);
    if (admitted.result === "pass") job.state = "passed";
    else if (admitted.result === "fail") job.state = "failed";
    else job.state = job.attempts < job.maxAttempts ? "queued" : "error";
    this.#clearLease(job);
    job.updatedAt = this.now();
    this.#updateCampaign(job.campaignRef);
    return immutable({ job: publicJob(job), campaign: this.campaignStatus(job.campaignRef), attestation: admitted });
  }

  reportInfrastructureFailure({ jobRef, runnerRef, leaseToken, reasonCode } = {}) {
    this.#expire();
    const job = this.#leasedJob(jobRef, runnerRef, leaseToken, new Set(["running", "cancel_requested"]));
    const reason = nonEmptyString(reasonCode, "reasonCode", 64);
    if (!INFRA_FAILURE_CODES.has(reason)) throw new TypeError("reasonCode is unsupported");
    job.lastInfrastructureFailure = reason;
    if (job.state === "cancel_requested" || reason === "CANCELED") {
      const campaign = this.campaigns.get(job.campaignRef);
      if (campaign.state === "canceled" || job.cancelReason === "campaign_cancel") job.state = "canceled";
      else job.state = this.projectPaused ? "paused" : "queued";
    } else job.state = job.attempts < job.maxAttempts ? "queued" : "error";
    delete job.cancelReason;
    this.#clearLease(job);
    job.updatedAt = this.now();
    this.#updateCampaign(job.campaignRef);
    return immutable({ job: publicJob(job), campaign: this.campaignStatus(job.campaignRef) });
  }

  cancelCampaign(campaignRef) {
    const campaign = this.#campaign(campaignRef);
    if (!ACTIVE_CAMPAIGN_STATES.has(campaign.state)) return this.campaignStatus(campaign.campaignRef);
    campaign.state = "canceled";
    campaign.updatedAt = this.now();
    for (const job of this.#campaignJobs(campaign)) {
      if (new Set(["queued", "paused"]).has(job.state)) job.state = "canceled";
      else if (new Set(["running", "cancel_requested"]).has(job.state)) { job.state = "cancel_requested"; job.cancelReason = "campaign_cancel"; }
      job.updatedAt = campaign.updatedAt;
    }
    return this.campaignStatus(campaign.campaignRef);
  }

  pauseProject() {
    if (this.projectPaused) return this.toJSON();
    this.projectPaused = true;
    this.pauseEpoch += 1;
    for (const job of this.jobs.values()) if (job.state === "running") { job.state = "cancel_requested"; job.cancelReason = "project_pause"; job.updatedAt = this.now(); }
    return this.toJSON();
  }

  resumeProject() {
    this.projectPaused = false;
    for (const job of this.jobs.values()) {
      if (job.state === "paused" && ACTIVE_CAMPAIGN_STATES.has(this.campaigns.get(job.campaignRef)?.state)) { job.state = "queued"; delete job.cancelReason; job.updatedAt = this.now(); }
    }
    return this.toJSON();
  }

  sweep() {
    this.#expire();
    return this.toJSON();
  }

  campaignStatus(campaignRef) {
    const campaign = this.#campaign(campaignRef);
    return publicCampaign(campaign, this.#campaignJobs(campaign));
  }

  jobStatus(jobRef) {
    return publicJob(this.#job(jobRef));
  }

  #updateCampaign(campaignRef) {
    const campaign = this.#campaign(campaignRef);
    if (!ACTIVE_CAMPAIGN_STATES.has(campaign.state)) return;
    const jobs = this.#campaignJobs(campaign);
    if (jobs.every((job) => job.state === "passed")) {
      const attestationRefs = jobs.flatMap((job) => job.attestationRefs);
      const gateReceipt = this.qualityAuthority.evaluateGate({ planRef: campaign.planRef, binding: campaign.binding, attestationRefs });
      campaign.gateReceipt = gateReceipt;
      campaign.state = gateReceipt.decision === "pass" ? "passed" : "failed";
    } else if (jobs.some((job) => new Set(["failed", "error"]).has(job.state)) && jobs.every((job) => TERMINAL_JOB_STATES.has(job.state))) campaign.state = "failed";
    else campaign.state = "running";
    campaign.updatedAt = this.now();
  }

  #expire() {
    const current = this.now();
    for (const job of this.jobs.values()) {
      if (!new Set(["running", "cancel_requested"]).has(job.state) || job.leaseExpiresAt > current) continue;
      if (job.state === "cancel_requested") {
        const campaign = this.campaigns.get(job.campaignRef);
        if (campaign.state === "canceled" || job.cancelReason === "campaign_cancel") job.state = "canceled";
        else job.state = this.projectPaused ? "paused" : "queued";
      } else job.state = job.attempts < job.maxAttempts ? "queued" : "error";
      delete job.cancelReason;
      job.lastInfrastructureFailure = "TIMEOUT";
      this.#clearLease(job);
      job.updatedAt = current;
      this.#updateCampaign(job.campaignRef);
    }
  }

  #clearLease(job) {
    delete job.runnerRef;
    delete job.runnerKeyId;
    delete job.leaseToken;
    delete job.leaseExpiresAt;
    delete job.attemptStartedAt;
  }

  #leasedJob(jobRef, runnerRef, leaseToken, states) {
    const job = this.#job(jobRef);
    if (!states.has(job.state) || job.runnerRef !== nonEmptyString(runnerRef, "runnerRef", 128) || job.leaseToken !== nonEmptyString(leaseToken, "leaseToken", 128)) throw new Error("test job lease is stale or belongs to another runner");
    return job;
  }

  #template(templateRef) {
    const template = this.templates.get(nonEmptyString(templateRef, "templateRef", 128));
    if (template === undefined) throw new Error("test template is unknown");
    return template;
  }

  #campaign(campaignRef) {
    const campaign = this.campaigns.get(nonEmptyString(campaignRef, "campaignRef", 128));
    if (campaign === undefined) throw new Error("test campaign is unknown");
    return campaign;
  }

  #campaignJobs(campaign) {
    return campaign.jobRefs.map((ref) => this.jobs.get(ref));
  }

  #job(jobRef) {
    const job = this.jobs.get(nonEmptyString(jobRef, "jobRef", 128));
    if (job === undefined) throw new Error("test job is unknown");
    return job;
  }
}

export {
  CAMPAIGN_PROFILES,
  DEFAULT_LEASE_MS,
  INFRA_FAILURE_CODES,
  MAX_LEASE_MS,
  MAX_TEMPLATE_TIMEOUT_MS,
  ORCHESTRATOR_HOST_STATE_VERSION,
  ORCHESTRATOR_VERSION,
};
