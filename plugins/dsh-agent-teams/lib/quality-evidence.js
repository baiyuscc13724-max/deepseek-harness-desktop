import { createHash, createHmac, createPrivateKey, createPublicKey, sign as cryptoSign, timingSafeEqual, verify as cryptoVerify } from "node:crypto";

const QUALITY_PROTOCOL_VERSION = 1;
const QUALITY_HOST_STATE_VERSION = 1;
const MAX_HOST_RECORDS = 100_000;
const COMMIT_REF = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const DIGEST_REF = /^sha256:[a-f0-9]{64}$/u;
const TRUST_RANK = Object.freeze({ untrusted: 0, standard: 1, trusted: 2 });
const TEST_RESULTS = new Set(["pass", "fail", "error"]);
const MAX_EVIDENCE_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const DEFAULT_GATE_TTL_MS = 30 * 60 * 1_000;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nonEmptyString(value, field, max = 2_000) {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) throw new TypeError(`${field} must be a non-empty string of at most ${max} characters`);
  return value.trim();
}
function safeInteger(value, field, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new TypeError(`${field} must be a safe integer of at least ${minimum}`);
  return value;
}
function commitRef(value, field) {
  const ref = nonEmptyString(value, field, 64).toLowerCase();
  if (!COMMIT_REF.test(ref)) throw new TypeError(`${field} is not a valid commit reference`);
  return ref;
}
function digestRef(value, field) {
  const ref = nonEmptyString(value, field, 80).toLowerCase();
  if (!DIGEST_REF.test(ref)) throw new TypeError(`${field} is not a sha256 digest reference`);
  return ref;
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
function stateMac(value, secret) {
  const body = { ...value };
  delete body.stateMac;
  return createHmac("sha256", secret).update(canonicalJson(body)).digest("base64url");
}
function verifyStateMac(value, secret) {
  if (typeof value.stateMac !== "string") throw new Error("Quality Host state authentication failed");
  const expected = Buffer.from(stateMac(value, secret));
  const supplied = Buffer.from(value.stateMac);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new Error("Quality Host state authentication failed");
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
function keyObject(value, kind, field) {
  let key;
  try {
    if (isRecord(value) && value.type === kind && typeof value.export === "function") key = value;
    else key = kind === "private" ? createPrivateKey(value) : createPublicKey(value);
  } catch (error) { throw new TypeError(`${field} is not a valid ${kind} key: ${String(error)}`); }
  if (key.asymmetricKeyType !== "ed25519") throw new TypeError(`${field} must be Ed25519`);
  return key;
}
function publicKeyId(value) {
  const bytes = keyObject(value, "public", "publicKey").export({ type: "spki", format: "der" });
  return shaRef("key", bytes);
}
function signObject(value, privateKey) {
  return cryptoSign(null, Buffer.from(canonicalJson(value)), keyObject(privateKey, "private", "privateKey")).toString("base64url");
}
function verifyObject(value, signature, publicKey) {
  if (typeof signature !== "string" || signature === "") return false;
  try { return cryptoVerify(null, Buffer.from(canonicalJson(value)), keyObject(publicKey, "public", "publicKey"), Buffer.from(signature, "base64url")); }
  catch { return false; }
}
function normalizeBinding(value) {
  if (!isRecord(value)) throw new TypeError("binding must be an object");
  return immutable({
    projectRef: nonEmptyString(value.projectRef, "binding.projectRef", 128),
    repositoryRef: nonEmptyString(value.repositoryRef, "binding.repositoryRef", 128),
    authorityEpoch: safeInteger(value.authorityEpoch, "binding.authorityEpoch", 1),
    mergeGroupRef: nonEmptyString(value.mergeGroupRef, "binding.mergeGroupRef", 128),
    baseHead: commitRef(value.baseHead, "binding.baseHead"),
    resultCommit: commitRef(value.resultCommit, "binding.resultCommit"),
    artifactSetRef: nonEmptyString(value.artifactSetRef, "binding.artifactSetRef", 128),
    manifestDigest: digestRef(value.manifestDigest, "binding.manifestDigest"),
  });
}
function normalizeCounts(value) {
  if (!isRecord(value)) throw new TypeError("counts must be an object");
  const counts = {
    total: safeInteger(value.total, "counts.total"),
    passed: safeInteger(value.passed, "counts.passed"),
    failed: safeInteger(value.failed, "counts.failed"),
    skipped: safeInteger(value.skipped, "counts.skipped"),
  };
  if (counts.passed + counts.failed + counts.skipped !== counts.total) throw new Error("test counts must sum to total");
  return immutable(counts);
}
function attestationBody(value) {
  return {
    version: value.version,
    planRef: value.planRef,
    suiteRef: value.suiteRef,
    runnerRef: value.runnerRef,
    runnerKeyId: value.runnerKeyId,
    binding: value.binding,
    result: value.result,
    counts: value.counts,
    environmentDigest: value.environmentDigest,
    evidenceDigest: value.evidenceDigest,
    startedAt: value.startedAt,
    finishedAt: value.finishedAt,
  };
}
function gateBody(value) {
  return {
    version: value.version,
    planRef: value.planRef,
    binding: value.binding,
    decision: value.decision,
    requiredSuiteRefs: value.requiredSuiteRefs,
    attestationRefs: value.attestationRefs,
    reasonCodes: value.reasonCodes,
    qualityKeyId: value.qualityKeyId,
    issuedAt: value.issuedAt,
    expiresAt: value.expiresAt,
  };
}

export function signTestAttestation(attestation, runnerPrivateKey) {
  const body = attestationBody(attestation);
  normalizeBinding(body.binding);
  normalizeCounts(body.counts);
  return immutable({ ...body, signature: signObject(body, runnerPrivateKey) });
}

export function verifyGateReceiptWithKey(receipt, binding, qualityPublicKey, now = Date.now()) {
  if (!isRecord(receipt)) return false;
  let normalized;
  let expectedKeyId;
  try { normalized = normalizeBinding(binding); expectedKeyId = publicKeyId(qualityPublicKey); } catch { return false; }
  const body = gateBody(receipt);
  return receipt.gateReceiptRef === shaRef("gate", Buffer.from(canonicalJson(body)))
    && body.decision === "pass"
    && body.qualityKeyId === expectedKeyId
    && canonicalJson(body.binding) === canonicalJson(normalized)
    && Number.isSafeInteger(body.issuedAt)
    && body.issuedAt <= now + MAX_CLOCK_SKEW_MS
    && Number.isSafeInteger(body.expiresAt)
    && body.expiresAt > now
    && verifyObject(body, receipt.signature, qualityPublicKey);
}

export class QualityEvidenceAuthority {
  constructor({ projectRef, repositoryRef, secret, qualityPrivateKey, now = Date.now, maxClockSkewMs = MAX_CLOCK_SKEW_MS } = {}) {
    this.projectRef = nonEmptyString(projectRef, "projectRef", 128);
    this.repositoryRef = nonEmptyString(repositoryRef, "repositoryRef", 128);
    this.secret = nonEmptyString(secret, "secret", 512);
    if (this.secret.length < 24) throw new TypeError("secret must contain at least 24 characters");
    this.qualityPrivateKey = keyObject(qualityPrivateKey, "private", "qualityPrivateKey");
    this.qualityPublicKey = createPublicKey(this.qualityPrivateKey);
    this.qualityKeyId = publicKeyId(this.qualityPublicKey);
    if (typeof now !== "function") throw new TypeError("now must be a function");
    this.now = now;
    this.maxClockSkewMs = safeInteger(maxClockSkewMs, "maxClockSkewMs", 1);
    this.runners = new Map();
    this.plans = new Map();
    this.attestations = new Map();
    this.receipts = new Map();
  }

  static restore(hostState, { now = Date.now } = {}) {
    const state = losslessJson(hostState, "Quality Host state");
    if (!isRecord(state) || state.version !== QUALITY_HOST_STATE_VERSION || state.stateKind !== "quality-evidence-host") throw new TypeError("Quality Host state version or kind is unsupported");
    const secret = nonEmptyString(state.secret, "state.secret", 512);
    verifyStateMac(state, secret);
    if (!Array.isArray(state.runners) || !Array.isArray(state.plans) || !Array.isArray(state.attestations) || !Array.isArray(state.receipts) || state.runners.length + state.plans.length + state.attestations.length + state.receipts.length > MAX_HOST_RECORDS) throw new TypeError("Quality Host state record collections are invalid");
    let privateKey;
    try { privateKey = createPrivateKey({ key: Buffer.from(nonEmptyString(state.qualityPrivateKeyDer, "state.qualityPrivateKeyDer", 16_384), "base64url"), type: "pkcs8", format: "der" }); }
    catch (error) { throw new TypeError(`Quality Host private key is invalid: ${String(error)}`); }
    const authority = new QualityEvidenceAuthority({ projectRef: state.projectRef, repositoryRef: state.repositoryRef, secret, qualityPrivateKey: privateKey, now, maxClockSkewMs: safeInteger(state.maxClockSkewMs, "state.maxClockSkewMs", 1) });
    if (authority.qualityKeyId !== state.qualityKeyId) throw new Error("Quality Host key identity is invalid");
    for (const raw of state.runners) {
      if (!isRecord(raw)) throw new TypeError("Quality Host runner is invalid");
      let publicKey;
      try { publicKey = createPublicKey({ key: Buffer.from(nonEmptyString(raw.publicKeyDer, "runner.publicKeyDer", 16_384), "base64url"), type: "spki", format: "der" }); }
      catch (error) { throw new TypeError(`Quality Host runner key is invalid: ${String(error)}`); }
      const runnerRef = nonEmptyString(raw.runnerRef, "runner.runnerRef", 128);
      const capabilities = [...new Set(raw.capabilities.map((item, index) => nonEmptyString(item, `runner.capabilities[${index}]`, 128)))].sort();
      if (!Object.hasOwn(TRUST_RANK, raw.trust) || !new Set(["active", "revoked"]).has(raw.status) || publicKeyId(publicKey) !== raw.runnerKeyId || authority.runners.has(runnerRef)) throw new Error("Quality Host runner binding is invalid");
      const runner = { runnerRef, displayName: nonEmptyString(raw.displayName, "runner.displayName", 128), trust: raw.trust, capabilities, publicKey, runnerKeyId: raw.runnerKeyId, status: raw.status, createdAt: safeInteger(raw.createdAt, "runner.createdAt") };
      if (raw.status === "revoked") runner.revokedAt = safeInteger(raw.revokedAt, "runner.revokedAt");
      authority.runners.set(runnerRef, runner);
    }
    for (const raw of state.plans) {
      if (!isRecord(raw) || !Array.isArray(raw.suites)) throw new TypeError("Quality Host TestPlan is invalid");
      const body = { version: QUALITY_PROTOCOL_VERSION, projectRef: authority.projectRef, repositoryRef: authority.repositoryRef, name: nonEmptyString(raw.name, "plan.name", 256), suites: raw.suites.map((suite, index) => immutable({ suiteRef: nonEmptyString(suite.suiteRef, `plan.suites[${index}].suiteRef`, 128), tier: nonEmptyString(suite.tier, `plan.suites[${index}].tier`, 64), required: suite.required !== false, minimumTrust: nonEmptyString(suite.minimumTrust, `plan.suites[${index}].minimumTrust`, 32), minimumTests: safeInteger(suite.minimumTests, `plan.suites[${index}].minimumTests`, 1) })).sort((a, b) => a.suiteRef.localeCompare(b.suiteRef)), maxEvidenceAgeMs: safeInteger(raw.maxEvidenceAgeMs, "plan.maxEvidenceAgeMs", 1), gateTtlMs: safeInteger(raw.gateTtlMs, "plan.gateTtlMs", 1) };
      if (body.suites.some((suite) => !Object.hasOwn(TRUST_RANK, suite.minimumTrust)) || new Set(body.suites.map((suite) => suite.suiteRef)).size !== body.suites.length || body.maxEvidenceAgeMs > MAX_EVIDENCE_AGE_MS || body.gateTtlMs > DEFAULT_GATE_TTL_MS) throw new Error("Quality Host TestPlan policy is invalid");
      const planRef = nonEmptyString(raw.planRef, "plan.planRef", 128);
      if (planRef !== shaRef("testplan", Buffer.from(canonicalJson(body))) || authority.plans.has(planRef)) throw new Error("Quality Host TestPlan reference is invalid");
      authority.plans.set(planRef, immutable({ ...body, planRef, createdAt: safeInteger(raw.createdAt, "plan.createdAt") }));
    }
    for (const raw of state.attestations) {
      const body = attestationBody(raw);
      const plan = authority.plans.get(body.planRef);
      const runner = authority.runners.get(body.runnerRef);
      if (plan === undefined || runner === undefined || !plan.suites.some((suite) => suite.suiteRef === body.suiteRef) || runner.runnerKeyId !== body.runnerKeyId || !runner.capabilities.includes(body.suiteRef)) throw new Error("Quality Host attestation binding is invalid");
      body.binding = normalizeBinding(body.binding);
      body.counts = normalizeCounts(body.counts);
      body.result = nonEmptyString(body.result, "attestation.result", 32);
      body.environmentDigest = digestRef(body.environmentDigest, "attestation.environmentDigest");
      body.evidenceDigest = digestRef(body.evidenceDigest, "attestation.evidenceDigest");
      body.startedAt = safeInteger(body.startedAt, "attestation.startedAt");
      body.finishedAt = safeInteger(body.finishedAt, "attestation.finishedAt");
      if (!TEST_RESULTS.has(body.result) || body.finishedAt < body.startedAt || body.binding.projectRef !== authority.projectRef || body.binding.repositoryRef !== authority.repositoryRef || !verifyObject(body, raw.signature, runner.publicKey)) throw new Error("Quality Host attestation is invalid");
      const attestationRef = nonEmptyString(raw.attestationRef, "attestation.attestationRef", 128);
      if (attestationRef !== shaRef("attestation", Buffer.from(canonicalJson(body))) || authority.attestations.has(attestationRef)) throw new Error("Quality Host attestation reference is invalid");
      authority.attestations.set(attestationRef, immutable({ ...body, attestationRef, signature: nonEmptyString(raw.signature, "attestation.signature", 1_024), admittedAt: safeInteger(raw.admittedAt, "attestation.admittedAt") }));
    }
    for (const raw of state.receipts) {
      const body = gateBody(raw);
      body.binding = normalizeBinding(body.binding);
      if (!authority.plans.has(body.planRef) || !new Set(["pass", "fail"]).has(body.decision) || body.qualityKeyId !== authority.qualityKeyId || body.binding.projectRef !== authority.projectRef || body.binding.repositoryRef !== authority.repositoryRef || !Array.isArray(body.requiredSuiteRefs) || !Array.isArray(body.attestationRefs) || !Array.isArray(body.reasonCodes) || !verifyObject(body, raw.signature, authority.qualityPublicKey)) throw new Error("Quality Host Gate Receipt is invalid");
      for (const ref of body.attestationRefs) if (!authority.attestations.has(ref)) throw new Error("Quality Host Gate Receipt references unknown evidence");
      const gateReceiptRef = nonEmptyString(raw.gateReceiptRef, "receipt.gateReceiptRef", 128);
      if (gateReceiptRef !== shaRef("gate", Buffer.from(canonicalJson(body))) || authority.receipts.has(gateReceiptRef)) throw new Error("Quality Host Gate Receipt reference is invalid");
      authority.receipts.set(gateReceiptRef, immutable({ ...body, gateReceiptRef, signature: nonEmptyString(raw.signature, "receipt.signature", 1_024) }));
    }
    return authority;
  }

  exportHostState() {
    const state = {
      version: QUALITY_HOST_STATE_VERSION,
      stateKind: "quality-evidence-host",
      projectRef: this.projectRef,
      repositoryRef: this.repositoryRef,
      secret: this.secret,
      qualityPrivateKeyDer: this.qualityPrivateKey.export({ type: "pkcs8", format: "der" }).toString("base64url"),
      qualityKeyId: this.qualityKeyId,
      maxClockSkewMs: this.maxClockSkewMs,
      runners: [...this.runners.values()].map((runner) => ({ runnerRef: runner.runnerRef, displayName: runner.displayName, trust: runner.trust, capabilities: [...runner.capabilities], publicKeyDer: runner.publicKey.export({ type: "spki", format: "der" }).toString("base64url"), runnerKeyId: runner.runnerKeyId, status: runner.status, createdAt: runner.createdAt, ...(runner.revokedAt === undefined ? {} : { revokedAt: runner.revokedAt }) })),
      plans: [...this.plans.values()].map((plan) => losslessJson(plan, "TestPlan")),
      attestations: [...this.attestations.values()].map((attestation) => losslessJson(attestation, "attestation")),
      receipts: [...this.receipts.values()].map((receipt) => losslessJson(receipt, "receipt")),
    };
    return immutable({ ...state, stateMac: stateMac(state, this.secret) });
  }

  qualityPublicKeyPem() {
    return this.qualityPublicKey.export({ type: "spki", format: "pem" });
  }

  toJSON() {
    return { version: QUALITY_PROTOCOL_VERSION, projectRef: this.projectRef, repositoryRef: this.repositoryRef, qualityKeyId: this.qualityKeyId, runnerCount: this.runners.size, planCount: this.plans.size, attestationCount: this.attestations.size };
  }

  registerRunner({ runnerHandle, displayName, trust, capabilities, publicKey } = {}) {
    const privateHandle = nonEmptyString(runnerHandle, "runnerHandle", 512);
    const normalizedTrust = nonEmptyString(trust, "trust", 32);
    if (!Object.hasOwn(TRUST_RANK, normalizedTrust)) throw new TypeError("trust must be untrusted, standard, or trusted");
    if (!Array.isArray(capabilities) || capabilities.length < 1 || capabilities.length > 128) throw new TypeError("capabilities must contain from 1 through 128 suite refs");
    const normalizedCapabilities = [...new Set(capabilities.map((item, index) => nonEmptyString(item, `capabilities[${index}]`, 128)))].sort();
    const runnerRef = opaqueRef("runner", this.secret, this.projectRef, privateHandle);
    if (this.runners.has(runnerRef)) throw new Error("runner identity is already registered");
    const key = keyObject(publicKey, "public", "publicKey");
    const record = {
      runnerRef,
      displayName: nonEmptyString(displayName, "displayName", 128),
      trust: normalizedTrust,
      capabilities: normalizedCapabilities,
      publicKey: key,
      runnerKeyId: publicKeyId(key),
      status: "active",
      createdAt: this.now(),
    };
    this.runners.set(runnerRef, record);
    return immutable({ runnerRef, displayName: record.displayName, trust: record.trust, capabilities: [...record.capabilities], runnerKeyId: record.runnerKeyId, status: record.status, createdAt: record.createdAt });
  }

  revokeRunner(runnerRef) {
    const runner = this.#runner(runnerRef);
    runner.status = "revoked";
    runner.revokedAt = this.now();
    return immutable({ runnerRef: runner.runnerRef, status: runner.status, revokedAt: runner.revokedAt });
  }

  createPlan({ name, suites, maxEvidenceAgeMs = MAX_EVIDENCE_AGE_MS, gateTtlMs = DEFAULT_GATE_TTL_MS } = {}) {
    const normalizedName = nonEmptyString(name, "name", 256);
    if (!Array.isArray(suites) || suites.length < 1 || suites.length > 128) throw new TypeError("suites must contain from 1 through 128 entries");
    const seen = new Set();
    const normalizedSuites = suites.map((suite, index) => {
      if (!isRecord(suite)) throw new TypeError(`suites[${index}] must be an object`);
      const suiteRef = nonEmptyString(suite.suiteRef, `suites[${index}].suiteRef`, 128);
      if (seen.has(suiteRef)) throw new Error(`suite ${suiteRef} is duplicated`);
      seen.add(suiteRef);
      const minimumTrust = nonEmptyString(suite.minimumTrust, `suites[${index}].minimumTrust`, 32);
      if (!Object.hasOwn(TRUST_RANK, minimumTrust)) throw new TypeError("minimumTrust must be untrusted, standard, or trusted");
      return immutable({
        suiteRef,
        tier: nonEmptyString(suite.tier, `suites[${index}].tier`, 64),
        required: suite.required !== false,
        minimumTrust,
        minimumTests: safeInteger(suite.minimumTests ?? 1, `suites[${index}].minimumTests`, 1),
      });
    }).sort((a, b) => a.suiteRef.localeCompare(b.suiteRef));
    const evidenceAge = safeInteger(maxEvidenceAgeMs, "maxEvidenceAgeMs", 1);
    if (evidenceAge > MAX_EVIDENCE_AGE_MS) throw new RangeError(`maxEvidenceAgeMs exceeds ${MAX_EVIDENCE_AGE_MS}`);
    const receiptTtl = safeInteger(gateTtlMs, "gateTtlMs", 1);
    if (receiptTtl > DEFAULT_GATE_TTL_MS) throw new RangeError(`gateTtlMs exceeds ${DEFAULT_GATE_TTL_MS}`);
    const body = { version: QUALITY_PROTOCOL_VERSION, projectRef: this.projectRef, repositoryRef: this.repositoryRef, name: normalizedName, suites: normalizedSuites, maxEvidenceAgeMs: evidenceAge, gateTtlMs: receiptTtl };
    const planRef = shaRef("testplan", Buffer.from(canonicalJson(body)));
    const existing = this.plans.get(planRef);
    if (existing !== undefined) return existing;
    const plan = immutable({ ...body, planRef, createdAt: this.now() });
    this.plans.set(planRef, plan);
    return plan;
  }

  prepareAttestation({ planRef, suiteRef, runnerRef, binding, result, counts, environmentDigest, evidenceDigest, startedAt, finishedAt } = {}) {
    const plan = this.#plan(planRef);
    const suite = plan.suites.find((entry) => entry.suiteRef === suiteRef);
    if (suite === undefined) throw new Error("suite is not part of the TestPlan");
    const runner = this.#runner(runnerRef);
    if (runner.status !== "active" || !runner.capabilities.includes(suite.suiteRef)) throw new Error("runner is inactive or lacks this suite capability");
    const normalizedResult = nonEmptyString(result, "result", 32);
    if (!TEST_RESULTS.has(normalizedResult)) throw new TypeError("result must be pass, fail, or error");
    const normalizedCounts = normalizeCounts(counts);
    if (normalizedResult === "pass" && (normalizedCounts.failed !== 0 || normalizedCounts.total < suite.minimumTests)) throw new Error("passing evidence must meet minimum test counts with zero failures");
    const start = safeInteger(startedAt, "startedAt");
    const finish = safeInteger(finishedAt, "finishedAt");
    if (finish < start) throw new Error("finishedAt must not precede startedAt");
    const normalizedBinding = normalizeBinding(binding);
    if (normalizedBinding.projectRef !== this.projectRef || normalizedBinding.repositoryRef !== this.repositoryRef) throw new Error("attestation binding is outside this quality authority");
    return immutable({
      version: QUALITY_PROTOCOL_VERSION,
      planRef: plan.planRef,
      suiteRef: suite.suiteRef,
      runnerRef: runner.runnerRef,
      runnerKeyId: runner.runnerKeyId,
      binding: normalizedBinding,
      result: normalizedResult,
      counts: normalizedCounts,
      environmentDigest: digestRef(environmentDigest, "environmentDigest"),
      evidenceDigest: digestRef(evidenceDigest, "evidenceDigest"),
      startedAt: start,
      finishedAt: finish,
    });
  }

  submitAttestation({ attestation, signature } = {}) {
    if (!isRecord(attestation)) throw new TypeError("attestation must be an object");
    const body = attestationBody(attestation);
    const plan = this.#plan(body.planRef);
    const suite = plan.suites.find((entry) => entry.suiteRef === body.suiteRef);
    if (suite === undefined) throw new Error("attestation suite is outside its TestPlan");
    const runner = this.#runner(body.runnerRef);
    if (runner.status !== "active" || body.runnerKeyId !== runner.runnerKeyId || !runner.capabilities.includes(body.suiteRef)) throw new Error("attestation runner is unavailable or mismatched");
    body.binding = normalizeBinding(body.binding);
    if (body.binding.projectRef !== this.projectRef || body.binding.repositoryRef !== this.repositoryRef) throw new Error("attestation binding is outside this quality authority");
    body.counts = normalizeCounts(body.counts);
    body.result = nonEmptyString(body.result, "result", 32);
    if (!TEST_RESULTS.has(body.result)) throw new TypeError("attestation result is unsupported");
    body.environmentDigest = digestRef(body.environmentDigest, "environmentDigest");
    body.evidenceDigest = digestRef(body.evidenceDigest, "evidenceDigest");
    body.startedAt = safeInteger(body.startedAt, "startedAt");
    body.finishedAt = safeInteger(body.finishedAt, "finishedAt");
    if (body.finishedAt < body.startedAt) throw new Error("attestation time range is invalid");
    const current = this.now();
    if (body.finishedAt > current + this.maxClockSkewMs || body.finishedAt + plan.maxEvidenceAgeMs < current) throw new Error("attestation is outside the accepted evidence window");
    if (body.result === "pass" && (body.counts.failed !== 0 || body.counts.total < suite.minimumTests)) throw new Error("passing attestation does not meet suite requirements");
    if (!verifyObject(body, signature, runner.publicKey)) throw new Error("test attestation signature is invalid");
    const attestationRef = shaRef("attestation", Buffer.from(canonicalJson(body)));
    const existing = this.attestations.get(attestationRef);
    if (existing !== undefined) return immutable({ admitted: true, duplicate: true, attestation: existing });
    const record = immutable({ ...body, attestationRef, signature, admittedAt: current });
    this.attestations.set(attestationRef, record);
    return immutable({ admitted: true, duplicate: false, attestation: record });
  }

  evaluateGate({ planRef, binding, attestationRefs } = {}) {
    const plan = this.#plan(planRef);
    const normalizedBinding = normalizeBinding(binding);
    if (normalizedBinding.projectRef !== this.projectRef || normalizedBinding.repositoryRef !== this.repositoryRef) throw new Error("gate binding is outside this quality authority");
    if (!Array.isArray(attestationRefs) || attestationRefs.length > 512) throw new TypeError("attestationRefs must be an array with at most 512 entries");
    const supplied = [...new Set(attestationRefs.map((ref, index) => nonEmptyString(ref, `attestationRefs[${index}]`, 128)))];
    const attestations = supplied.map((ref) => {
      const attestation = this.attestations.get(ref);
      if (attestation === undefined) throw new Error(`attestation ${ref} is unknown`);
      return attestation;
    });
    const requiredSuites = plan.suites.filter((suite) => suite.required);
    const acceptedRefs = [];
    const reasonCodes = [];
    const current = this.now();
    for (const suite of requiredSuites) {
      const candidates = attestations.filter((attestation) => attestation.planRef === plan.planRef && attestation.suiteRef === suite.suiteRef && canonicalJson(attestation.binding) === canonicalJson(normalizedBinding));
      const passing = candidates.filter((attestation) => {
        const runner = this.runners.get(attestation.runnerRef);
        return attestation.result === "pass"
          && attestation.counts.failed === 0
          && attestation.counts.total >= suite.minimumTests
          && attestation.finishedAt + plan.maxEvidenceAgeMs >= current
          && runner !== undefined
          && runner.status === "active"
          && TRUST_RANK[runner.trust] >= TRUST_RANK[suite.minimumTrust];
      }).sort((a, b) => b.finishedAt - a.finishedAt)[0];
      if (passing === undefined) reasonCodes.push(`MISSING_PASS:${suite.suiteRef}`);
      else acceptedRefs.push(passing.attestationRef);
    }
    const decision = reasonCodes.length === 0 ? "pass" : "fail";
    const body = {
      version: QUALITY_PROTOCOL_VERSION,
      planRef: plan.planRef,
      binding: normalizedBinding,
      decision,
      requiredSuiteRefs: requiredSuites.map((suite) => suite.suiteRef),
      attestationRefs: acceptedRefs.sort(),
      reasonCodes,
      qualityKeyId: this.qualityKeyId,
      issuedAt: current,
      expiresAt: current + plan.gateTtlMs,
    };
    const gateReceiptRef = shaRef("gate", Buffer.from(canonicalJson(body)));
    const existing = this.receipts.get(gateReceiptRef);
    if (existing !== undefined) return existing;
    const receipt = immutable({ ...body, gateReceiptRef, signature: signObject(body, this.qualityPrivateKey) });
    this.receipts.set(gateReceiptRef, receipt);
    return receipt;
  }

  verifyGateReceipt(receipt, binding) {
    return verifyGateReceiptWithKey(receipt, binding, this.qualityPublicKey, this.now());
  }

  getAttestation(attestationRef) {
    return this.attestations.get(nonEmptyString(attestationRef, "attestationRef", 128));
  }

  getRunner(runnerRef) {
    const runner = this.#runner(runnerRef);
    return immutable({ runnerRef: runner.runnerRef, displayName: runner.displayName, trust: runner.trust, capabilities: [...runner.capabilities], runnerKeyId: runner.runnerKeyId, status: runner.status, createdAt: runner.createdAt, ...(runner.revokedAt === undefined ? {} : { revokedAt: runner.revokedAt }) });
  }

  getPlan(planRef) {
    return this.#plan(planRef);
  }

  #runner(runnerRef) {
    const runner = this.runners.get(nonEmptyString(runnerRef, "runnerRef", 128));
    if (runner === undefined) throw new Error("runner is unknown");
    return runner;
  }

  #plan(planRef) {
    const plan = this.plans.get(nonEmptyString(planRef, "planRef", 128));
    if (plan === undefined) throw new Error("TestPlan is unknown");
    return plan;
  }
}

export {
  DEFAULT_GATE_TTL_MS,
  MAX_EVIDENCE_AGE_MS,
  QUALITY_HOST_STATE_VERSION,
  QUALITY_PROTOCOL_VERSION,
  TRUST_RANK,
};
