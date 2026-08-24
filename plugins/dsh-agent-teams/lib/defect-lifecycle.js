import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const DEFECT_PROTOCOL_VERSION = 1;
const DEFECT_HOST_STATE_VERSION = 1;
const MAX_HOST_RECORDS = 100_000;
const COMMIT_REF = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const DIGEST_REF = /^sha256:[a-f0-9]{64}$/u;
const SOURCE_TYPES = new Set(["test", "runtime", "user_report", "external", "release_observation"]);
const SEVERITY_RANK = Object.freeze({ blocker: 0, critical: 1, major: 2, minor: 3, info: 4 });
const DEFECT_STATES = new Set(["open", "fixing", "verification_pending", "verified", "released", "reopened", "closed"]);

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
  return JSON.parse(encoded);
}
function hostStateMac(value, secret) {
  const body = { ...value };
  delete body.stateMac;
  return createHmac("sha256", secret).update(canonicalJson(body)).digest("base64url");
}
function verifyHostStateMac(value, secret) {
  if (typeof value.stateMac !== "string") throw new Error("Defect Host state authentication failed");
  const expected = Buffer.from(hostStateMac(value, secret));
  const supplied = Buffer.from(value.stateMac);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new Error("Defect Host state authentication failed");
}
function shaRef(prefix, value) {
  return `${prefix}_${createHash("sha256").update(value).digest("base64url")}`;
}
function immutable(value) {
  if (Array.isArray(value)) for (const item of value) immutable(item);
  else if (isRecord(value)) for (const nested of Object.values(value)) immutable(nested);
  return Object.freeze(value);
}
function publicRef(value, field, prefix) {
  const ref = nonEmptyString(value, field, 256);
  const pattern = prefix === undefined ? /^[a-z][a-z0-9]*_[A-Za-z0-9_-]{6,}$/u : new RegExp(`^${prefix}_[A-Za-z0-9_-]{6,}$`, "u");
  if (!pattern.test(ref)) throw new TypeError(`${field} must be an opaque public reference`);
  return ref;
}
function severity(value, field = "severity") {
  const normalized = nonEmptyString(value, field, 32);
  if (!Object.hasOwn(SEVERITY_RANK, normalized)) throw new TypeError(`${field} must be blocker, critical, major, minor, or info`);
  return normalized;
}

export class DefectLifecycle {
  constructor({ projectRef, repositoryRef, secret, now = Date.now, resolveAttestation } = {}) {
    this.projectRef = publicRef(projectRef, "projectRef", "project");
    this.repositoryRef = publicRef(repositoryRef, "repositoryRef", "repository");
    this.secret = secret === undefined ? undefined : nonEmptyString(secret, "secret", 512);
    if (this.secret !== undefined && this.secret.length < 24) throw new TypeError("secret must contain at least 24 characters");
    if (typeof now !== "function") throw new TypeError("now must be a function");
    if (typeof resolveAttestation !== "function") throw new TypeError("resolveAttestation must be a function");
    this.now = now;
    this.resolveAttestation = resolveAttestation;
    this.signals = new Map();
    this.occurrences = new Map();
    this.defects = new Map();
    this.defectByFingerprint = new Map();
    this.fixes = new Map();
    this.verifications = new Map();
    this.releaseObservations = new Map();
  }

  static restore(hostState, { now = Date.now, resolveAttestation } = {}) {
    const state = losslessJson(hostState, "Defect Host state");
    if (!isRecord(state) || state.version !== DEFECT_HOST_STATE_VERSION || state.stateKind !== "defect-lifecycle-host") throw new TypeError("Defect Host state version or kind is unsupported");
    const secret = nonEmptyString(state.secret, "state.secret", 512);
    verifyHostStateMac(state, secret);
    const collections = [state.signals, state.occurrences, state.defects, state.fixes, state.verifications, state.releaseObservations];
    if (collections.some((value) => !Array.isArray(value)) || collections.reduce((total, value) => total + value.length, 0) > MAX_HOST_RECORDS) throw new TypeError("Defect Host state collections are invalid");
    const lifecycle = new DefectLifecycle({ projectRef: state.projectRef, repositoryRef: state.repositoryRef, secret, now, resolveAttestation });
    for (const raw of state.signals) {
      const body = { version: DEFECT_PROTOCOL_VERSION, projectRef: lifecycle.projectRef, repositoryRef: lifecycle.repositoryRef, sourceType: nonEmptyString(raw.sourceType, "signal.sourceType", 64), sourceRef: publicRef(raw.sourceRef, "signal.sourceRef"), fingerprintDigest: digestRef(raw.fingerprintDigest, "signal.fingerprintDigest"), title: nonEmptyString(raw.title, "signal.title", 512), evidenceDigest: digestRef(raw.evidenceDigest, "signal.evidenceDigest"), observedCommit: commitRef(raw.observedCommit, "signal.observedCommit"), artifactSetRef: publicRef(raw.artifactSetRef, "signal.artifactSetRef", "artifactset"), severityHint: severity(raw.severityHint, "signal.severityHint"), observedAt: safeTime(raw.observedAt, "signal.observedAt") };
      if (!SOURCE_TYPES.has(body.sourceType)) throw new Error("Defect Host Signal source is invalid");
      const signalRef = nonEmptyString(raw.signalRef, "signal.signalRef", 128);
      if (signalRef !== shaRef("signal", Buffer.from(canonicalJson(body))) || lifecycle.signals.has(signalRef)) throw new Error("Defect Host Signal reference is invalid");
      lifecycle.signals.set(signalRef, immutable({ ...body, signalRef, recordedAt: safeTime(raw.recordedAt, "signal.recordedAt") }));
    }
    for (const raw of state.occurrences) {
      const signal = lifecycle.signals.get(raw.signalRef);
      if (signal === undefined) throw new Error("Defect Host Occurrence Signal is unknown");
      const body = { version: DEFECT_PROTOCOL_VERSION, projectRef: lifecycle.projectRef, repositoryRef: lifecycle.repositoryRef, signalRef: signal.signalRef, fingerprintDigest: signal.fingerprintDigest, observedCommit: signal.observedCommit, artifactSetRef: signal.artifactSetRef, environmentDigest: digestRef(raw.environmentDigest, "occurrence.environmentDigest"), reproductionDigest: digestRef(raw.reproductionDigest, "occurrence.reproductionDigest"), observedAt: safeTime(raw.observedAt, "occurrence.observedAt") };
      const occurrenceRef = nonEmptyString(raw.occurrenceRef, "occurrence.occurrenceRef", 128);
      if (occurrenceRef !== shaRef("occurrence", Buffer.from(canonicalJson(body))) || lifecycle.occurrences.has(occurrenceRef)) throw new Error("Defect Host Occurrence reference is invalid");
      lifecycle.occurrences.set(occurrenceRef, immutable({ ...body, occurrenceRef, recordedAt: safeTime(raw.recordedAt, "occurrence.recordedAt") }));
    }
    for (const raw of state.fixes) {
      const body = { version: DEFECT_PROTOCOL_VERSION, projectRef: lifecycle.projectRef, repositoryRef: lifecycle.repositoryRef, defectRef: nonEmptyString(raw.defectRef, "fix.defectRef", 128), changeSetRef: publicRef(raw.changeSetRef, "fix.changeSetRef", "changeset"), fixCommit: commitRef(raw.fixCommit, "fix.fixCommit"), artifactSetRef: publicRef(raw.artifactSetRef, "fix.artifactSetRef", "artifactset") };
      const fixRef = nonEmptyString(raw.fixRef, "fix.fixRef", 128);
      if (fixRef !== shaRef("fix", Buffer.from(canonicalJson(body))) || lifecycle.fixes.has(fixRef)) throw new Error("Defect Host Fix reference is invalid");
      lifecycle.fixes.set(fixRef, immutable({ ...body, fixRef, createdAt: safeTime(raw.createdAt, "fix.createdAt") }));
    }
    for (const raw of state.verifications) {
      const fix = lifecycle.fixes.get(raw.fixRef);
      const attestationRef = publicRef(raw.attestationRef, "verification.attestationRef", "attestation");
      const attestation = resolveAttestation(attestationRef);
      if (fix === undefined || !isRecord(attestation) || attestation.attestationRef !== attestationRef || attestation.binding?.projectRef !== lifecycle.projectRef || attestation.binding?.repositoryRef !== lifecycle.repositoryRef || attestation.binding?.resultCommit !== fix.fixCommit || attestation.binding?.artifactSetRef !== fix.artifactSetRef) throw new Error("Defect Host Verification binding is invalid");
      const result = attestation.result === "pass" ? "pass" : "fail";
      const body = { version: DEFECT_PROTOCOL_VERSION, projectRef: lifecycle.projectRef, repositoryRef: lifecycle.repositoryRef, defectRef: fix.defectRef, fixRef: fix.fixRef, attestationRef, fixCommit: fix.fixCommit, artifactSetRef: fix.artifactSetRef, evidenceDigest: digestRef(attestation.evidenceDigest, "attestation.evidenceDigest"), result };
      const verificationRef = nonEmptyString(raw.verificationRef, "verification.verificationRef", 128);
      if (verificationRef !== shaRef("verification", Buffer.from(canonicalJson(body))) || lifecycle.verifications.has(verificationRef)) throw new Error("Defect Host Verification reference is invalid");
      lifecycle.verifications.set(verificationRef, immutable({ ...body, verificationRef, verifiedAt: safeTime(raw.verifiedAt, "verification.verifiedAt") }));
    }
    for (const raw of state.releaseObservations) {
      const verification = lifecycle.verifications.get(raw.verificationRef);
      const body = { version: DEFECT_PROTOCOL_VERSION, projectRef: lifecycle.projectRef, repositoryRef: lifecycle.repositoryRef, defectRef: nonEmptyString(raw.defectRef, "release.defectRef", 128), releaseRef: publicRef(raw.releaseRef, "release.releaseRef"), commit: commitRef(raw.commit, "release.commit"), artifactSetRef: publicRef(raw.artifactSetRef, "release.artifactSetRef", "artifactset"), verificationRef: nonEmptyString(raw.verificationRef, "release.verificationRef", 128), outcome: nonEmptyString(raw.outcome, "release.outcome", 32), ...(raw.occurrenceRef === undefined ? {} : { occurrenceRef: nonEmptyString(raw.occurrenceRef, "release.occurrenceRef", 128) }), observedAt: safeTime(raw.observedAt, "release.observedAt") };
      if (verification === undefined || verification.defectRef !== body.defectRef || verification.fixCommit !== body.commit || verification.artifactSetRef !== body.artifactSetRef || !new Set(["clean", "recurred"]).has(body.outcome) || (body.outcome === "recurred") !== (body.occurrenceRef !== undefined)) throw new Error("Defect Host ReleaseObservation binding is invalid");
      if (body.occurrenceRef !== undefined) {
        const occurrence = lifecycle.occurrences.get(body.occurrenceRef);
        if (occurrence === undefined || occurrence.observedCommit !== body.commit || occurrence.artifactSetRef !== body.artifactSetRef) throw new Error("Defect Host release recurrence is invalid");
      }
      const releaseObservationRef = nonEmptyString(raw.releaseObservationRef, "release.releaseObservationRef", 128);
      if (releaseObservationRef !== shaRef("releaseobservation", Buffer.from(canonicalJson(body))) || lifecycle.releaseObservations.has(releaseObservationRef)) throw new Error("Defect Host ReleaseObservation reference is invalid");
      lifecycle.releaseObservations.set(releaseObservationRef, immutable({ ...body, releaseObservationRef, recordedAt: safeTime(raw.recordedAt, "release.recordedAt") }));
    }
    for (const raw of state.defects) {
      if (!isRecord(raw) || !Array.isArray(raw.occurrenceRefs) || !Array.isArray(raw.fixRefs) || !Array.isArray(raw.verificationRefs) || !Array.isArray(raw.releaseObservationRefs)) throw new TypeError("Defect Host Defect is invalid");
      const defectRef = nonEmptyString(raw.defectRef, "defect.defectRef", 128);
      const fingerprintDigest = digestRef(raw.fingerprintDigest, "defect.fingerprintDigest");
      const record = immutable({ ...raw, version: DEFECT_PROTOCOL_VERSION, projectRef: lifecycle.projectRef, repositoryRef: lifecycle.repositoryRef, defectRef, fingerprintDigest, title: nonEmptyString(raw.title, "defect.title", 512), severity: severity(raw.severity), ownerCollaboratorRef: publicRef(raw.ownerCollaboratorRef, "defect.ownerCollaboratorRef", "collaborator"), state: nonEmptyString(raw.state, "defect.state", 64), occurrenceRefs: raw.occurrenceRefs.map((ref) => nonEmptyString(ref, "defect.occurrenceRef", 128)), fixRefs: raw.fixRefs.map((ref) => nonEmptyString(ref, "defect.fixRef", 128)), verificationRefs: raw.verificationRefs.map((ref) => nonEmptyString(ref, "defect.verificationRef", 128)), releaseObservationRefs: raw.releaseObservationRefs.map((ref) => nonEmptyString(ref, "defect.releaseObservationRef", 128)), recurrenceCount: Number.isSafeInteger(raw.recurrenceCount) && raw.recurrenceCount >= 0 ? raw.recurrenceCount : (() => { throw new TypeError("defect.recurrenceCount is invalid"); })(), createdAt: safeTime(raw.createdAt, "defect.createdAt"), updatedAt: safeTime(raw.updatedAt, "defect.updatedAt") });
      if (!DEFECT_STATES.has(record.state) || lifecycle.defects.has(defectRef) || lifecycle.defectByFingerprint.has(fingerprintDigest) || record.occurrenceRefs.some((ref) => lifecycle.occurrences.get(ref)?.fingerprintDigest !== fingerprintDigest) || record.fixRefs.some((ref) => lifecycle.fixes.get(ref)?.defectRef !== defectRef) || record.verificationRefs.some((ref) => lifecycle.verifications.get(ref)?.defectRef !== defectRef) || record.releaseObservationRefs.some((ref) => lifecycle.releaseObservations.get(ref)?.defectRef !== defectRef)) throw new Error("Defect Host Defect relationship is invalid");
      lifecycle.defects.set(defectRef, record);
      lifecycle.defectByFingerprint.set(fingerprintDigest, defectRef);
    }
    return lifecycle;
  }

  exportHostState() {
    if (this.secret === undefined) throw new Error("DefectLifecycle requires a Host secret before it can be persisted");
    const state = { version: DEFECT_HOST_STATE_VERSION, stateKind: "defect-lifecycle-host", projectRef: this.projectRef, repositoryRef: this.repositoryRef, secret: this.secret, signals: [...this.signals.values()].map((value) => losslessJson(value, "Signal")), occurrences: [...this.occurrences.values()].map((value) => losslessJson(value, "Occurrence")), defects: [...this.defects.values()].map((value) => losslessJson(value, "Defect")), fixes: [...this.fixes.values()].map((value) => losslessJson(value, "Fix")), verifications: [...this.verifications.values()].map((value) => losslessJson(value, "Verification")), releaseObservations: [...this.releaseObservations.values()].map((value) => losslessJson(value, "ReleaseObservation")) };
    return immutable({ ...state, stateMac: hostStateMac(state, this.secret) });
  }

  toJSON() {
    return { version: DEFECT_PROTOCOL_VERSION, projectRef: this.projectRef, repositoryRef: this.repositoryRef, signalCount: this.signals.size, occurrenceCount: this.occurrences.size, defectCount: this.defects.size };
  }

  recordSignal({ sourceType, sourceRef, fingerprintDigest, title, evidenceDigest, observedCommit, artifactSetRef, severityHint = "major", observedAt = this.now() } = {}) {
    const type = nonEmptyString(sourceType, "sourceType", 64);
    if (!SOURCE_TYPES.has(type)) throw new TypeError("sourceType is unsupported");
    const body = {
      version: DEFECT_PROTOCOL_VERSION,
      projectRef: this.projectRef,
      repositoryRef: this.repositoryRef,
      sourceType: type,
      sourceRef: publicRef(sourceRef, "sourceRef"),
      fingerprintDigest: digestRef(fingerprintDigest, "fingerprintDigest"),
      title: nonEmptyString(title, "title", 512),
      evidenceDigest: digestRef(evidenceDigest, "evidenceDigest"),
      observedCommit: commitRef(observedCommit, "observedCommit"),
      artifactSetRef: publicRef(artifactSetRef, "artifactSetRef", "artifactset"),
      severityHint: severity(severityHint, "severityHint"),
      observedAt: safeTime(observedAt, "observedAt"),
    };
    const signalRef = shaRef("signal", Buffer.from(canonicalJson(body)));
    const existing = this.signals.get(signalRef);
    if (existing !== undefined) return existing;
    const signal = immutable({ ...body, signalRef, recordedAt: this.now() });
    this.signals.set(signalRef, signal);
    return signal;
  }

  recordOccurrence({ signalRef, environmentDigest, reproductionDigest, observedAt = this.now() } = {}) {
    const signal = this.#signal(signalRef);
    const body = {
      version: DEFECT_PROTOCOL_VERSION,
      projectRef: this.projectRef,
      repositoryRef: this.repositoryRef,
      signalRef: signal.signalRef,
      fingerprintDigest: signal.fingerprintDigest,
      observedCommit: signal.observedCommit,
      artifactSetRef: signal.artifactSetRef,
      environmentDigest: digestRef(environmentDigest, "environmentDigest"),
      reproductionDigest: digestRef(reproductionDigest, "reproductionDigest"),
      observedAt: safeTime(observedAt, "observedAt"),
    };
    const occurrenceRef = shaRef("occurrence", Buffer.from(canonicalJson(body)));
    const existing = this.occurrences.get(occurrenceRef);
    if (existing !== undefined) return existing;
    const occurrence = immutable({ ...body, occurrenceRef, recordedAt: this.now() });
    this.occurrences.set(occurrenceRef, occurrence);
    return occurrence;
  }

  triageOccurrence({ occurrenceRef, title, severity: requestedSeverity, ownerCollaboratorRef } = {}) {
    const occurrence = this.#occurrence(occurrenceRef);
    const signal = this.#signal(occurrence.signalRef);
    const normalizedSeverity = severity(requestedSeverity ?? signal.severityHint);
    const owner = publicRef(ownerCollaboratorRef, "ownerCollaboratorRef", "collaborator");
    const existingRef = this.defectByFingerprint.get(occurrence.fingerprintDigest);
    if (existingRef !== undefined) {
      const defect = this.#defect(existingRef);
      const occurrenceRefs = defect.occurrenceRefs.includes(occurrence.occurrenceRef) ? defect.occurrenceRefs : [...defect.occurrenceRefs, occurrence.occurrenceRef];
      const wasResolved = new Set(["verified", "released", "closed"]).has(defect.state);
      const state = wasResolved || defect.state === "verification_pending" ? "reopened" : defect.state;
      return this.#replaceDefect(defect.defectRef, {
        title: title === undefined ? defect.title : nonEmptyString(title, "title", 512),
        severity: SEVERITY_RANK[normalizedSeverity] < SEVERITY_RANK[defect.severity] ? normalizedSeverity : defect.severity,
        ownerCollaboratorRef: owner,
        occurrenceRefs,
        recurrenceCount: defect.recurrenceCount + (defect.occurrenceRefs.includes(occurrence.occurrenceRef) ? 0 : 1),
        state,
        updatedAt: this.now(),
      });
    }
    const body = {
      version: DEFECT_PROTOCOL_VERSION,
      projectRef: this.projectRef,
      repositoryRef: this.repositoryRef,
      fingerprintDigest: occurrence.fingerprintDigest,
      title: nonEmptyString(title ?? signal.title, "title", 512),
      severity: normalizedSeverity,
      ownerCollaboratorRef: owner,
    };
    const defectRef = shaRef("defect", Buffer.from(canonicalJson(body)));
    const current = this.now();
    const defect = immutable({
      ...body,
      defectRef,
      state: "open",
      occurrenceRefs: [occurrence.occurrenceRef],
      fixRefs: [],
      verificationRefs: [],
      releaseObservationRefs: [],
      recurrenceCount: 0,
      createdAt: current,
      updatedAt: current,
    });
    this.defects.set(defectRef, defect);
    this.defectByFingerprint.set(occurrence.fingerprintDigest, defectRef);
    return defect;
  }

  assignDefect({ defectRef, ownerCollaboratorRef } = {}) {
    const defect = this.#defect(defectRef);
    if (defect.state === "closed") throw new Error("a closed defect must be reopened by a new occurrence before assignment");
    return this.#replaceDefect(defect.defectRef, { ownerCollaboratorRef: publicRef(ownerCollaboratorRef, "ownerCollaboratorRef", "collaborator"), updatedAt: this.now() });
  }

  linkFix({ defectRef, changeSetRef, fixCommit, artifactSetRef } = {}) {
    const defect = this.#defect(defectRef);
    if (new Set(["verified", "released", "closed"]).has(defect.state)) throw new Error("resolved defects require a new occurrence before another fix");
    const body = {
      version: DEFECT_PROTOCOL_VERSION,
      projectRef: this.projectRef,
      repositoryRef: this.repositoryRef,
      defectRef: defect.defectRef,
      changeSetRef: publicRef(changeSetRef, "changeSetRef", "changeset"),
      fixCommit: commitRef(fixCommit, "fixCommit"),
      artifactSetRef: publicRef(artifactSetRef, "artifactSetRef", "artifactset"),
    };
    const fixRef = shaRef("fix", Buffer.from(canonicalJson(body)));
    let fix = this.fixes.get(fixRef);
    if (fix === undefined) {
      fix = immutable({ ...body, fixRef, createdAt: this.now() });
      this.fixes.set(fixRef, fix);
    }
    const fixRefs = defect.fixRefs.includes(fixRef) ? defect.fixRefs : [...defect.fixRefs, fixRef];
    this.#replaceDefect(defect.defectRef, { state: "verification_pending", fixRefs, updatedAt: this.now() });
    return fix;
  }

  recordVerification({ defectRef, fixRef, attestationRef } = {}) {
    const defect = this.#defect(defectRef);
    if (!new Set(["verification_pending", "fixing", "reopened"]).has(defect.state)) throw new Error("defect is not awaiting verification");
    const fix = this.fixes.get(nonEmptyString(fixRef, "fixRef", 128));
    if (fix === undefined || fix.defectRef !== defect.defectRef || !defect.fixRefs.includes(fix.fixRef)) throw new Error("verification fix is not linked to this defect");
    const ref = publicRef(attestationRef, "attestationRef", "attestation");
    const attestation = this.resolveAttestation(ref);
    if (!isRecord(attestation) || attestation.attestationRef !== ref) throw new Error("verification attestation is unknown or unauthenticated");
    if (attestation.binding?.projectRef !== this.projectRef || attestation.binding?.repositoryRef !== this.repositoryRef || attestation.binding?.resultCommit !== fix.fixCommit || attestation.binding?.artifactSetRef !== fix.artifactSetRef) throw new Error("verification attestation is not bound to the exact fix artifact");
    const result = attestation.result === "pass" ? "pass" : "fail";
    const body = {
      version: DEFECT_PROTOCOL_VERSION,
      projectRef: this.projectRef,
      repositoryRef: this.repositoryRef,
      defectRef: defect.defectRef,
      fixRef: fix.fixRef,
      attestationRef: ref,
      fixCommit: fix.fixCommit,
      artifactSetRef: fix.artifactSetRef,
      evidenceDigest: digestRef(attestation.evidenceDigest, "attestation.evidenceDigest"),
      result,
    };
    const verificationRef = shaRef("verification", Buffer.from(canonicalJson(body)));
    let verification = this.verifications.get(verificationRef);
    if (verification === undefined) {
      verification = immutable({ ...body, verificationRef, verifiedAt: this.now() });
      this.verifications.set(verificationRef, verification);
    }
    const verificationRefs = defect.verificationRefs.includes(verificationRef) ? defect.verificationRefs : [...defect.verificationRefs, verificationRef];
    this.#replaceDefect(defect.defectRef, { state: result === "pass" ? "verified" : "reopened", verificationRefs, updatedAt: this.now() });
    return verification;
  }

  recordReleaseObservation({ defectRef, releaseRef, commit, artifactSetRef, occurrenceRef, observedAt = this.now() } = {}) {
    const defect = this.#defect(defectRef);
    if (!new Set(["verified", "released", "closed"]).has(defect.state)) throw new Error("release observation requires a verified defect");
    const commitValue = commitRef(commit, "commit");
    const artifactRef = publicRef(artifactSetRef, "artifactSetRef", "artifactset");
    const passedVerification = defect.verificationRefs.map((ref) => this.verifications.get(ref)).find((verification) => verification?.result === "pass" && verification.fixCommit === commitValue && verification.artifactSetRef === artifactRef);
    if (passedVerification === undefined) throw new Error("release observation must use an exactly verified fix artifact");
    let recurrence;
    if (occurrenceRef !== undefined && occurrenceRef !== null && occurrenceRef !== "") {
      recurrence = this.#occurrence(occurrenceRef);
      if (recurrence.fingerprintDigest !== defect.fingerprintDigest) throw new Error("release recurrence fingerprint does not match this defect");
      if (recurrence.observedCommit !== commitValue || recurrence.artifactSetRef !== artifactRef) throw new Error("release recurrence is not bound to the observed release artifact");
    }
    const body = {
      version: DEFECT_PROTOCOL_VERSION,
      projectRef: this.projectRef,
      repositoryRef: this.repositoryRef,
      defectRef: defect.defectRef,
      releaseRef: publicRef(releaseRef, "releaseRef"),
      commit: commitValue,
      artifactSetRef: artifactRef,
      verificationRef: passedVerification.verificationRef,
      outcome: recurrence === undefined ? "clean" : "recurred",
      ...(recurrence === undefined ? {} : { occurrenceRef: recurrence.occurrenceRef }),
      observedAt: safeTime(observedAt, "observedAt"),
    };
    const releaseObservationRef = shaRef("releaseobservation", Buffer.from(canonicalJson(body)));
    let observation = this.releaseObservations.get(releaseObservationRef);
    if (observation === undefined) {
      observation = immutable({ ...body, releaseObservationRef, recordedAt: this.now() });
      this.releaseObservations.set(releaseObservationRef, observation);
    }
    const releaseObservationRefs = defect.releaseObservationRefs.includes(releaseObservationRef) ? defect.releaseObservationRefs : [...defect.releaseObservationRefs, releaseObservationRef];
    const occurrenceRefs = recurrence === undefined || defect.occurrenceRefs.includes(recurrence.occurrenceRef) ? defect.occurrenceRefs : [...defect.occurrenceRefs, recurrence.occurrenceRef];
    this.#replaceDefect(defect.defectRef, {
      state: recurrence === undefined ? "released" : "reopened",
      releaseObservationRefs,
      occurrenceRefs,
      recurrenceCount: defect.recurrenceCount + (recurrence !== undefined && !defect.occurrenceRefs.includes(recurrence.occurrenceRef) ? 1 : 0),
      updatedAt: this.now(),
    });
    return observation;
  }

  closeDefect({ defectRef, releaseObservationRef } = {}) {
    const defect = this.#defect(defectRef);
    if (defect.state !== "released") throw new Error("only a cleanly observed released defect can close");
    const observation = this.releaseObservations.get(nonEmptyString(releaseObservationRef, "releaseObservationRef", 128));
    if (observation === undefined || observation.defectRef !== defect.defectRef || observation.outcome !== "clean" || !defect.releaseObservationRefs.includes(observation.releaseObservationRef)) throw new Error("a clean ReleaseObservation for this defect is required");
    return this.#replaceDefect(defect.defectRef, { state: "closed", closedAt: this.now(), updatedAt: this.now() });
  }

  getDefect(defectRef) {
    return this.#defect(defectRef);
  }

  #signal(ref) {
    const signal = this.signals.get(nonEmptyString(ref, "signalRef", 128));
    if (signal === undefined) throw new Error("Signal is unknown");
    return signal;
  }

  #occurrence(ref) {
    const occurrence = this.occurrences.get(nonEmptyString(ref, "occurrenceRef", 128));
    if (occurrence === undefined) throw new Error("Occurrence is unknown");
    return occurrence;
  }

  #defect(ref) {
    const defect = this.defects.get(nonEmptyString(ref, "defectRef", 128));
    if (defect === undefined || !DEFECT_STATES.has(defect.state)) throw new Error("Defect is unknown or invalid");
    return defect;
  }

  #replaceDefect(ref, patch) {
    const replacement = immutable({ ...this.defects.get(ref), ...patch });
    this.defects.set(ref, replacement);
    return replacement;
  }
}

export {
  DEFECT_HOST_STATE_VERSION,
  DEFECT_PROTOCOL_VERSION,
  DEFECT_STATES,
  SEVERITY_RANK,
  SOURCE_TYPES,
};
