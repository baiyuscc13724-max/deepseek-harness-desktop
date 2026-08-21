import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

const CONNECTOR_VERSION = 1;
const CONNECTOR_HOST_STATE_VERSION = 1;
const PROVIDERS = new Set(["github", "gitlab", "jira"]);
const DEFECT_STATES = new Set(["open", "fixing", "verification_pending", "verified", "released", "reopened", "closed"]);
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_WEBHOOK_BYTES = 1024 * 1024;
const MAX_DELIVERIES = 10_000;
const REQUEST_TIMEOUT_MS = 30_000;

function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function nonEmptyString(value, field, max = 2_000) {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) throw new TypeError(`${field} must be a non-empty string of at most ${max} characters`);
  return value.trim();
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
  if (typeof value.stateMac !== "string" || !timingEqual(hostStateMac(value, secret), value.stateMac)) throw new Error("External Connector Host state authentication failed");
}
function immutable(value) {
  if (Array.isArray(value)) for (const item of value) immutable(item);
  else if (isRecord(value)) for (const nested of Object.values(value)) immutable(nested);
  return Object.freeze(value);
}
function opaqueRef(prefix, secret, ...parts) {
  return `${prefix}_${createHmac("sha256", secret).update(parts.map(String).join("\u0000")).digest("base64url").slice(0, 26)}`;
}
function safeBaseUrl(value, provider) {
  let url;
  try { url = new URL(nonEmptyString(value, "baseUrl", 2_000)); } catch { throw new TypeError("baseUrl must be an absolute URL"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (url.port && url.port !== "443")) throw new TypeError("baseUrl must be credential-free HTTPS on the default port");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  if (isIP(host) !== 0 || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".home.arpa")) throw new TypeError("baseUrl cannot target a local, private, or literal host");
  if (provider === "github" && url.origin !== "https://api.github.com") throw new TypeError("GitHub connector must use https://api.github.com");
  url.pathname = url.pathname.replace(/\/+$/u, "") || "/";
  return url;
}
function safeHeaders(value) {
  if (!isRecord(value)) throw new TypeError("credentialProvider must return a header object");
  const result = {};
  for (const [rawName, rawValue] of Object.entries(value)) {
    const name = nonEmptyString(rawName, "credential header name", 128).toLowerCase();
    const headerValue = nonEmptyString(rawValue, `credential header ${name}`, 8_192);
    if (!new Set(["authorization", "private-token", "x-api-key"]).has(name) || /[\r\n]/u.test(headerValue)) throw new TypeError("credentialProvider returned an unsafe header");
    result[name] = headerValue;
  }
  return result;
}
function responseJson(response) {
  if (!isRecord(response) || !Number.isSafeInteger(response.status) || response.status < 100 || response.status > 599) throw new Error("connector request returned an invalid response");
  if (response.status < 200 || response.status >= 300) throw new Error(`external defect platform rejected the bounded request (${response.status})`);
  if (response.body === undefined || response.body === null || response.body === "") return {};
  if ((isRecord(response.body) && !ArrayBuffer.isView(response.body)) || Array.isArray(response.body)) return response.body;
  const bytes = Buffer.isBuffer(response.body) ? response.body : Buffer.from(String(response.body));
  if (bytes.length > MAX_RESPONSE_BYTES) throw new RangeError("external defect response exceeds its size bound");
  try { return JSON.parse(bytes.toString("utf8")); } catch { throw new Error("external defect response is not valid JSON"); }
}
function adfDescription(text) {
  return { version: 1, type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}
function containsMarker(value, marker) {
  if (typeof value === "string") return value.includes(marker);
  if (value === null || value === undefined) return false;
  try { return canonicalJson(value).includes(marker); } catch { return false; }
}
function timingEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}
async function boundedFetch({ method, url, headers, body, timeoutMs = REQUEST_TIMEOUT_MS, maxResponseBytes = MAX_RESPONSE_BYTES }) {
  const response = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
  const reader = response.body?.getReader();
  const chunks = [];
  let size = 0;
  if (reader !== undefined) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxResponseBytes) { await reader.cancel(); throw new RangeError("external defect response exceeds its size bound"); }
      chunks.push(Buffer.from(value));
    }
  }
  return { status: response.status, body: Buffer.concat(chunks), headers: Object.fromEntries(response.headers.entries()) };
}

export class ExternalDefectConnector {
  #projectLocator;
  #credentialProvider;
  #webhookSecretProvider;
  #request;
  #mappings = new Map();
  #deliveryRefs = new Set();

  constructor({ provider, baseUrl, projectLocator, projectRef, repositoryRef, secret, credentialProvider, webhookSecretProvider, request = boundedFetch, jiraIssueType = "Task", jiraCloseTransitionId, jiraReopenTransitionId } = {}) {
    this.provider = nonEmptyString(provider, "provider", 32);
    if (!PROVIDERS.has(this.provider)) throw new TypeError("provider must be github, gitlab, or jira");
    this.baseUrl = safeBaseUrl(baseUrl, this.provider);
    this.projectRef = nonEmptyString(projectRef, "projectRef", 128);
    this.repositoryRef = nonEmptyString(repositoryRef, "repositoryRef", 128);
    this.secret = nonEmptyString(secret, "secret", 512);
    if (this.secret.length < 24) throw new TypeError("secret must contain at least 24 characters");
    this.#projectLocator = nonEmptyString(projectLocator, "projectLocator", 512);
    if (this.provider === "github" && !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/u.test(this.#projectLocator)) throw new TypeError("GitHub projectLocator must be owner/repository");
    if (this.provider === "jira" && !/^[A-Z][A-Z0-9_]{1,31}$/u.test(this.#projectLocator)) throw new TypeError("Jira projectLocator must be a project key");
    if (typeof credentialProvider !== "function" || typeof webhookSecretProvider !== "function" || typeof request !== "function") throw new TypeError("credentialProvider, webhookSecretProvider, and request must be functions");
    this.#credentialProvider = credentialProvider;
    this.#webhookSecretProvider = webhookSecretProvider;
    this.#request = request;
    this.jiraIssueType = nonEmptyString(jiraIssueType, "jiraIssueType", 128);
    this.jiraCloseTransitionId = jiraCloseTransitionId === undefined ? undefined : nonEmptyString(jiraCloseTransitionId, "jiraCloseTransitionId", 64);
    this.jiraReopenTransitionId = jiraReopenTransitionId === undefined ? undefined : nonEmptyString(jiraReopenTransitionId, "jiraReopenTransitionId", 64);
    this.connectorRef = opaqueRef("connector", this.secret, this.provider, this.baseUrl.origin, this.projectRef, this.repositoryRef);
  }

  static restore(hostState, { credentialProvider, webhookSecretProvider, request = boundedFetch } = {}) {
    const state = losslessJson(hostState, "External Connector Host state");
    if (!isRecord(state) || state.version !== CONNECTOR_HOST_STATE_VERSION || state.stateKind !== "external-defect-connector-host") throw new TypeError("External Connector Host state version or kind is unsupported");
    const secret = nonEmptyString(state.secret, "state.secret", 512);
    verifyHostStateMac(state, secret);
    if (!Array.isArray(state.mappings) || !Array.isArray(state.deliveryRefs) || state.mappings.length > 100_000 || state.deliveryRefs.length > MAX_DELIVERIES) throw new TypeError("External Connector Host state collections are invalid");
    const connector = new ExternalDefectConnector({ provider: state.provider, baseUrl: state.baseUrl, projectLocator: state.projectLocator, projectRef: state.projectRef, repositoryRef: state.repositoryRef, secret, credentialProvider, webhookSecretProvider, request, jiraIssueType: state.jiraIssueType, jiraCloseTransitionId: state.jiraCloseTransitionId, jiraReopenTransitionId: state.jiraReopenTransitionId });
    if (connector.connectorRef !== state.connectorRef) throw new Error("External Connector Host identity binding is invalid");
    for (const raw of state.mappings) {
      if (!isRecord(raw)) throw new TypeError("External Connector mapping is invalid");
      const defectRef = nonEmptyString(raw.defectRef, "mapping.defectRef", 128);
      const rawId = nonEmptyString(raw.rawId, "mapping.rawId", 256);
      const externalIssueRef = nonEmptyString(raw.externalIssueRef, "mapping.externalIssueRef", 128);
      if (externalIssueRef !== opaqueRef("externalissue", secret, connector.provider, rawId) || connector.#mappings.has(defectRef) || !new Set(["open", "closed"]).has(raw.desiredState)) throw new Error("External Connector mapping binding is invalid");
      connector.#mappings.set(defectRef, { externalIssueRef, rawId, desiredState: raw.desiredState, operationRef: nonEmptyString(raw.operationRef, "mapping.operationRef", 128) });
    }
    for (const ref of state.deliveryRefs) {
      const deliveryRef = nonEmptyString(ref, "deliveryRef", 128);
      if (!/^delivery_[A-Za-z0-9_-]{20,}$/u.test(deliveryRef) || connector.#deliveryRefs.has(deliveryRef)) throw new Error("External Connector delivery replay state is invalid");
      connector.#deliveryRefs.add(deliveryRef);
    }
    return connector;
  }

  exportHostState() {
    const state = {
      version: CONNECTOR_HOST_STATE_VERSION,
      stateKind: "external-defect-connector-host",
      connectorRef: this.connectorRef,
      provider: this.provider,
      baseUrl: this.baseUrl.href,
      projectLocator: this.#projectLocator,
      projectRef: this.projectRef,
      repositoryRef: this.repositoryRef,
      secret: this.secret,
      jiraIssueType: this.jiraIssueType,
      ...(this.jiraCloseTransitionId === undefined ? {} : { jiraCloseTransitionId: this.jiraCloseTransitionId }),
      ...(this.jiraReopenTransitionId === undefined ? {} : { jiraReopenTransitionId: this.jiraReopenTransitionId }),
      mappings: [...this.#mappings.entries()].map(([defectRef, mapping]) => ({ defectRef, ...mapping })),
      deliveryRefs: [...this.#deliveryRefs],
    };
    return immutable({ ...state, stateMac: hostStateMac(state, this.secret) });
  }

  toJSON() {
    return { version: CONNECTOR_VERSION, connectorRef: this.connectorRef, provider: this.provider, baseOrigin: this.baseUrl.origin, projectRef: this.projectRef, repositoryRef: this.repositoryRef, mappingCount: this.#mappings.size, replayCount: this.#deliveryRefs.size };
  }

  prepareDefectSync(defect) {
    if (!isRecord(defect)) throw new TypeError("defect must be an object");
    const defectRef = nonEmptyString(defect.defectRef, "defect.defectRef", 128);
    const state = nonEmptyString(defect.state, "defect.state", 64);
    if (!/^defect_[A-Za-z0-9_-]{6,}$/u.test(defectRef) || !DEFECT_STATES.has(state)) throw new TypeError("defect reference or state is invalid");
    const title = nonEmptyString(defect.title, "defect.title", 512);
    const severity = nonEmptyString(defect.severity, "defect.severity", 32);
    const bindingRef = opaqueRef("externalbinding", this.secret, this.connectorRef, defectRef);
    const marker = `dsh-defect:${bindingRef}`;
    const description = `${title}\n\nManaged by Harness Desktop.\n${marker}`;
    const body = { version: CONNECTOR_VERSION, connectorRef: this.connectorRef, defectRef, bindingRef, title, description, severity, desiredState: state === "closed" ? "closed" : "open" };
    const operationRef = opaqueRef("externalop", this.secret, canonicalJson(body));
    return immutable({ ...body, operationRef, operationMac: createHmac("sha256", this.secret).update(canonicalJson({ ...body, operationRef })).digest("base64url") });
  }

  async deliverDefect(operation) {
    const normalized = this.#verifyOperation(operation);
    const existing = await this.#findIssue(normalized);
    const issue = existing === undefined ? await this.#createIssue(normalized) : await this.#updateIssue(existing, normalized);
    const rawId = this.#issueId(issue);
    const externalIssueRef = opaqueRef("externalissue", this.secret, this.provider, rawId);
    this.#mappings.set(normalized.defectRef, { externalIssueRef, rawId, desiredState: normalized.desiredState, operationRef: normalized.operationRef });
    return immutable({ connectorRef: this.connectorRef, provider: this.provider, defectRef: normalized.defectRef, externalIssueRef, synchronizedState: normalized.desiredState, operationRef: normalized.operationRef });
  }

  async publishReleaseObservation({ defectRef, releaseObservation } = {}) {
    const mapping = this.#mappings.get(nonEmptyString(defectRef, "defectRef", 128));
    if (mapping === undefined) throw new Error("defect has no synchronized external issue");
    if (!isRecord(releaseObservation) || releaseObservation.defectRef !== defectRef) throw new Error("ReleaseObservation is not bound to this defect");
    const outcome = nonEmptyString(releaseObservation.outcome, "releaseObservation.outcome", 32);
    if (!new Set(["clean", "recurred"]).has(outcome)) throw new TypeError("ReleaseObservation outcome is invalid");
    const marker = opaqueRef("releasebinding", this.secret, releaseObservation.releaseObservationRef, mapping.externalIssueRef);
    if (!await this.#hasComment(mapping.rawId, marker)) await this.#commentIssue(mapping.rawId, `Harness release observation: ${outcome}.\n${marker}`);
    return immutable({ connectorRef: this.connectorRef, defectRef, externalIssueRef: mapping.externalIssueRef, observationRef: nonEmptyString(releaseObservation.releaseObservationRef, "releaseObservationRef", 128), outcome });
  }

  async acceptWebhook({ headers, body, receivedAt = Date.now() } = {}) {
    if (!isRecord(headers)) throw new TypeError("webhook headers must be an object");
    const normalizedHeaders = Object.fromEntries(Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), String(value)]));
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
    if (bytes.length < 1 || bytes.length > MAX_WEBHOOK_BYTES) throw new RangeError("webhook body is empty or exceeds its size bound");
    const secret = nonEmptyString(await this.#webhookSecretProvider({ connectorRef: this.connectorRef, provider: this.provider }), "webhook secret", 8_192);
    let deliveryId;
    let eventType;
    if (this.provider === "github") {
      deliveryId = nonEmptyString(normalizedHeaders["x-github-delivery"], "x-github-delivery", 256);
      eventType = nonEmptyString(normalizedHeaders["x-github-event"], "x-github-event", 128);
      const expected = `sha256=${createHmac("sha256", secret).update(bytes).digest("hex")}`;
      if (!timingEqual(expected, normalizedHeaders["x-hub-signature-256"])) throw new Error("webhook authentication failed");
    } else if (this.provider === "gitlab") {
      deliveryId = nonEmptyString(normalizedHeaders["x-gitlab-event-uuid"], "x-gitlab-event-uuid", 256);
      eventType = nonEmptyString(normalizedHeaders["x-gitlab-event"], "x-gitlab-event", 128);
      if (!timingEqual(secret, normalizedHeaders["x-gitlab-token"])) throw new Error("webhook authentication failed");
    } else {
      deliveryId = nonEmptyString(normalizedHeaders["x-dsh-delivery"], "x-dsh-delivery", 256);
      eventType = nonEmptyString(normalizedHeaders["x-atlassian-webhook-identifier"] ?? normalizedHeaders["x-dsh-event"], "Jira webhook event", 128);
      const expected = `sha256=${createHmac("sha256", secret).update(bytes).digest("hex")}`;
      if (!timingEqual(expected, normalizedHeaders["x-dsh-signature"])) throw new Error("webhook authentication failed");
    }
    let payload;
    try { payload = JSON.parse(bytes.toString("utf8")); } catch { throw new Error("webhook body is not valid JSON"); }
    const deliveryRef = opaqueRef("delivery", this.secret, this.provider, deliveryId);
    if (this.#deliveryRefs.has(deliveryRef)) return immutable({ duplicate: true, deliveryRef });
    this.#deliveryRefs.add(deliveryRef);
    while (this.#deliveryRefs.size > MAX_DELIVERIES) this.#deliveryRefs.delete(this.#deliveryRefs.values().next().value);
    const rawId = this.#webhookIssueId(payload);
    const mapping = rawId === undefined ? undefined : [...this.#mappings.entries()].find(([, value]) => value.rawId === rawId);
    return immutable({ duplicate: false, deliveryRef, eventRef: opaqueRef("externalevent", this.secret, deliveryRef, eventType, receivedAt), connectorRef: this.connectorRef, provider: this.provider, eventType: eventType.slice(0, 128), candidateAction: "external_state_changed", ...(mapping === undefined ? {} : { defectRef: mapping[0], externalIssueRef: mapping[1].externalIssueRef }) });
  }

  #verifyOperation(value) {
    if (!isRecord(value)) throw new TypeError("operation must be an object");
    const body = { version: value.version, connectorRef: value.connectorRef, defectRef: value.defectRef, bindingRef: value.bindingRef, title: value.title, description: value.description, severity: value.severity, desiredState: value.desiredState };
    const operationRef = nonEmptyString(value.operationRef, "operationRef", 128);
    const expectedRef = opaqueRef("externalop", this.secret, canonicalJson(body));
    const expectedMac = createHmac("sha256", this.secret).update(canonicalJson({ ...body, operationRef })).digest("base64url");
    if (body.version !== CONNECTOR_VERSION || body.connectorRef !== this.connectorRef || operationRef !== expectedRef || !timingEqual(expectedMac, value.operationMac) || !new Set(["open", "closed"]).has(body.desiredState)) throw new Error("external defect operation authentication failed");
    return { ...body, operationRef };
  }

  async #call(method, endpoint, body) {
    const url = new URL(endpoint.replace(/^\//u, ""), this.baseUrl.href.endsWith("/") ? this.baseUrl.href : `${this.baseUrl.href}/`);
    if (url.origin !== this.baseUrl.origin || !url.pathname.startsWith(this.baseUrl.pathname === "/" ? "/" : `${this.baseUrl.pathname}/`)) throw new Error("external connector endpoint escaped its configured origin");
    const credentials = safeHeaders(await this.#credentialProvider({ connectorRef: this.connectorRef, provider: this.provider, baseOrigin: this.baseUrl.origin }));
    const headers = { accept: "application/json", "content-type": "application/json", "user-agent": "Harness-Desktop-Defect-Connector", ...credentials };
    return responseJson(await this.#request({ method, url: url.href, headers, body, timeoutMs: REQUEST_TIMEOUT_MS, maxResponseBytes: MAX_RESPONSE_BYTES }));
  }

  async #findIssue(operation) {
    if (this.provider === "github") {
      const result = await this.#call("GET", `search/issues?q=${encodeURIComponent(`repo:${this.#projectLocator} in:body ${operation.bindingRef}`)}&per_page=10`);
      return (result.items ?? []).find((issue) => containsMarker(issue.body, operation.bindingRef));
    }
    if (this.provider === "gitlab") {
      const result = await this.#call("GET", `projects/${encodeURIComponent(this.#projectLocator)}/issues?scope=all&search=${encodeURIComponent(operation.bindingRef)}&per_page=10`);
      return (Array.isArray(result) ? result : []).find((issue) => containsMarker(issue.description, operation.bindingRef));
    }
    const jql = `project = ${this.#projectLocator} AND text ~ \"${operation.bindingRef}\"`;
    const result = await this.#call("GET", `rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=10&fields=summary,description,status`);
    return (result.issues ?? []).find((issue) => containsMarker(issue.fields?.description, operation.bindingRef));
  }

  async #createIssue(operation) {
    if (this.provider === "github") return this.#call("POST", `repos/${this.#projectLocator}/issues`, { title: operation.title, body: operation.description, labels: ["dsh-managed", `severity:${operation.severity}`] });
    if (this.provider === "gitlab") return this.#call("POST", `projects/${encodeURIComponent(this.#projectLocator)}/issues`, { title: operation.title, description: operation.description, labels: `dsh-managed,severity:${operation.severity}` });
    return this.#call("POST", "rest/api/3/issue", { fields: { project: { key: this.#projectLocator }, summary: operation.title, description: adfDescription(operation.description), issuetype: { name: this.jiraIssueType }, labels: ["dsh-managed", `severity-${operation.severity}`] } });
  }

  async #updateIssue(issue, operation) {
    const rawId = this.#issueId(issue);
    if (this.provider === "github") return this.#call("PATCH", `repos/${this.#projectLocator}/issues/${encodeURIComponent(rawId)}`, { title: operation.title, body: operation.description, state: operation.desiredState });
    if (this.provider === "gitlab") return this.#call("PUT", `projects/${encodeURIComponent(this.#projectLocator)}/issues/${encodeURIComponent(rawId)}`, { title: operation.title, description: operation.description, state_event: operation.desiredState === "closed" ? "close" : "reopen" });
    await this.#call("PUT", `rest/api/3/issue/${encodeURIComponent(rawId)}`, { fields: { summary: operation.title, description: adfDescription(operation.description) } });
    const transitionId = operation.desiredState === "closed" ? this.jiraCloseTransitionId : this.jiraReopenTransitionId;
    if (transitionId !== undefined) await this.#call("POST", `rest/api/3/issue/${encodeURIComponent(rawId)}/transitions`, { transition: { id: transitionId } });
    return { key: rawId };
  }

  async #hasComment(rawId, marker) {
    if (this.provider === "github") {
      const comments = await this.#call("GET", `repos/${this.#projectLocator}/issues/${encodeURIComponent(rawId)}/comments?per_page=100`);
      return (Array.isArray(comments) ? comments : []).some((comment) => containsMarker(comment.body, marker));
    }
    if (this.provider === "gitlab") {
      const notes = await this.#call("GET", `projects/${encodeURIComponent(this.#projectLocator)}/issues/${encodeURIComponent(rawId)}/notes?per_page=100`);
      return (Array.isArray(notes) ? notes : []).some((note) => containsMarker(note.body, marker));
    }
    const comments = await this.#call("GET", `rest/api/3/issue/${encodeURIComponent(rawId)}/comment?maxResults=100`);
    return (comments.comments ?? []).some((comment) => containsMarker(comment.body, marker));
  }

  async #commentIssue(rawId, text) {
    if (this.provider === "github") return this.#call("POST", `repos/${this.#projectLocator}/issues/${encodeURIComponent(rawId)}/comments`, { body: text });
    if (this.provider === "gitlab") return this.#call("POST", `projects/${encodeURIComponent(this.#projectLocator)}/issues/${encodeURIComponent(rawId)}/notes`, { body: text });
    return this.#call("POST", `rest/api/3/issue/${encodeURIComponent(rawId)}/comment`, { body: adfDescription(text) });
  }

  #issueId(issue) {
    const value = this.provider === "github" ? issue?.number : this.provider === "gitlab" ? issue?.iid : issue?.key;
    return nonEmptyString(String(value ?? ""), "external issue id", 256);
  }

  #webhookIssueId(payload) {
    const value = this.provider === "github" ? payload.issue?.number : this.provider === "gitlab" ? payload.object_attributes?.iid : payload.issue?.key;
    return value === undefined || value === null ? undefined : String(value);
  }
}

export {
  CONNECTOR_HOST_STATE_VERSION,
  CONNECTOR_VERSION,
  MAX_RESPONSE_BYTES,
  MAX_WEBHOOK_BYTES,
  PROVIDERS,
  boundedFetch,
};
