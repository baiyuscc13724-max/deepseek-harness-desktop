const OFFICIAL_CORE_BASELINE = Object.freeze({
  tag: "dsh-v0.1.2-alpha.5",
  commit: "db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5",
  license: "MIT",
  runtimeEquivalent: false,
});

const CAPABILITIES = Object.freeze(["projectIdentity", "task", "collaboration", "projection", "recovery"]);
const ADAPTER_KEYS = new Set(CAPABILITIES);
const VALID_PORT_SETS = new WeakSet();
const RAW_PUBLIC_KEYS = new Set([
  "actor", "actorref", "authority", "authorities", "canonicalprojectkey", "cwd", "execution", "filepath", "path",
  "project", "projectkey", "projectref", "role", "rootcwd", "rootpath", "session", "sessionid", "targetexecution",
  "userid", "workspace", "workspacepath",
]);

function portError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}
function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function ownData(value, key, code = "OFFICIAL_CORE_PROVIDER_DESCRIPTOR_INVALID") {
  const descriptor = isRecord(value) ? Object.getOwnPropertyDescriptor(value, key) : undefined;
  if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined || !("value" in descriptor)) throw portError(`provider field ${key} must be an own data property`, code);
  return descriptor.value;
}
function exactBaseline(value) {
  if (!isRecord(value)) return false;
  try {
    return ownData(value, "tag") === OFFICIAL_CORE_BASELINE.tag
      && ownData(value, "commit") === OFFICIAL_CORE_BASELINE.commit
      && ownData(value, "license") === OFFICIAL_CORE_BASELINE.license
      && ownData(value, "runtimeEquivalent") === OFFICIAL_CORE_BASELINE.runtimeEquivalent;
  } catch { return false; }
}
function method(value, key) {
  const candidate = ownData(value, key, "OFFICIAL_CORE_PROVIDER_INCOMPLETE");
  if (typeof candidate !== "function") throw portError(`provider adapter ${key} must be a function`, "OFFICIAL_CORE_PROVIDER_INCOMPLETE");
  return candidate.bind(value);
}
function normalizeAdapters(value) {
  if (!isRecord(value)) throw portError("provider adapters must be declared", "OFFICIAL_CORE_PROVIDER_INCOMPLETE");
  const extras = Reflect.ownKeys(value).filter((key) => typeof key !== "string" || !ADAPTER_KEYS.has(key));
  if (extras.length > 0) {
    if (extras.includes("writeMode") && ownData(value, "writeMode") === "dual-write") throw portError("bare dual-write providers are forbidden", "OFFICIAL_CORE_BARE_DUAL_WRITE_FORBIDDEN");
    throw portError("provider adapters contain unsupported declarations", "OFFICIAL_CORE_PROVIDER_INCOMPLETE");
  }
  const projectIdentity = ownData(value, "projectIdentity", "OFFICIAL_CORE_PROVIDER_INCOMPLETE");
  const task = ownData(value, "task", "OFFICIAL_CORE_PROVIDER_INCOMPLETE");
  const collaboration = ownData(value, "collaboration", "OFFICIAL_CORE_PROVIDER_INCOMPLETE");
  const projection = ownData(value, "projection", "OFFICIAL_CORE_PROVIDER_INCOMPLETE");
  const recovery = ownData(value, "recovery", "OFFICIAL_CORE_PROVIDER_INCOMPLETE");
  return Object.freeze({
    projectIdentity: Object.freeze({ open: method(projectIdentity, "open"), webEntry: method(projectIdentity, "webEntry") }),
    task: Object.freeze({ bind: method(task, "bind") }),
    collaboration: Object.freeze({ bind: method(collaboration, "bind") }),
    projection: Object.freeze({ createWebRuntime: method(projection, "createWebRuntime") }),
    recovery: Object.freeze({ continueRoot: method(recovery, "continueRoot"), recoverMember: method(recovery, "recoverMember"), reconcileMember: method(recovery, "reconcileMember") }),
  });
}
function declaredCapabilities(value) {
  if (!isRecord(value)) throw portError("provider capabilities are incomplete", "OFFICIAL_CORE_PROVIDER_INCOMPLETE");
  const keys = Reflect.ownKeys(value);
  if (keys.length !== CAPABILITIES.length || keys.some((key) => typeof key !== "string" || !CAPABILITIES.includes(key))) throw portError("provider capabilities are incomplete", "OFFICIAL_CORE_PROVIDER_INCOMPLETE");
  for (const capability of CAPABILITIES) if (ownData(value, capability, "OFFICIAL_CORE_PROVIDER_INCOMPLETE") !== true) throw portError(`provider capability ${capability} is not declared`, "OFFICIAL_CORE_PROVIDER_INCOMPLETE");
  return Object.freeze(Object.fromEntries(CAPABILITIES.map((capability) => [capability, true])));
}
function normalizeProvider(value) {
  if (!isRecord(value)) throw portError("provider is undeclared", "OFFICIAL_CORE_PROVIDER_UNDECLARED");
  let kind;
  try { kind = ownData(value, "kind"); }
  catch (error) {
    if (Object.getOwnPropertyDescriptor(value, "kind") === undefined) throw portError("provider is undeclared", "OFFICIAL_CORE_PROVIDER_UNDECLARED");
    throw error;
  }
  const id = ownData(value, "id");
  const role = ownData(value, "role");
  if (typeof id !== "string" || id.trim() === "" || id.length > 128 || !["custom", "official"].includes(kind) || !["primary", "shadow"].includes(role)) throw portError("provider declaration is invalid", "OFFICIAL_CORE_PROVIDER_UNDECLARED");
  if (kind === "official") throw portError("alpha.2 source evidence does not prove a compatible local official runtime", "OFFICIAL_CORE_OFFICIAL_RUNTIME_UNVERIFIED");
  if (kind !== "custom" || role !== "primary") throw portError("only the custom provider may be primary in this integration phase", "OFFICIAL_CORE_PRIMARY_REQUIRED");
  const schemaVersion = ownData(value, "schemaVersion");
  const storageMode = ownData(value, "storageMode");
  if (schemaVersion !== 12 || storageMode !== "sqlite-wal") throw portError("custom provider must preserve schema v12 and SQLite WAL", "OFFICIAL_CORE_PROVIDER_INCOMPLETE");
  const baseline = ownData(value, "baseline");
  if (!exactBaseline(baseline)) throw portError("provider baseline evidence is invalid", "OFFICIAL_CORE_BASELINE_INVALID");
  return Object.freeze({ id, kind, role, schemaVersion, storageMode, baseline: OFFICIAL_CORE_BASELINE, capabilities: declaredCapabilities(ownData(value, "capabilities")), adapters: normalizeAdapters(ownData(value, "adapters")) });
}
function ownContextData(context, field) {
  const descriptor = Object.getOwnPropertyDescriptor(context, field);
  if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined || !("value" in descriptor)) throw portError(`project identity context field ${field} must be an own data property`, "OFFICIAL_CORE_PROJECT_CONTEXT_INVALID");
  return descriptor.value;
}
function bestEffortDisposeOwnContext(context) {
  if (!isRecord(context)) return;
  const descriptor = Object.getOwnPropertyDescriptor(context, "dispose");
  if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined || typeof descriptor.value !== "function") return;
  try { descriptor.value.call(context); } catch {}
}
function privateContext(context) {
  if (!isRecord(context)) throw portError("project identity provider returned an invalid context", "OFFICIAL_CORE_PROJECT_CONTEXT_INVALID");
  const fields = ["projectRef", "databasePath", "execution", "actorResolver", "keyProvider", "dispose"];
  let values;
  try {
    values = Object.fromEntries(fields.map((field) => [field, ownContextData(context, field)]));
    const execution = values.execution;
    if (!isRecord(execution) || Object.getPrototypeOf(execution) !== null || !Object.isFrozen(execution) || Reflect.ownKeys(execution).length !== 0) throw portError("Host execution capability must be a frozen, empty, null-prototype object", "OFFICIAL_CORE_EXECUTION_SERIALIZABLE");
    if (typeof values.actorResolver !== "function" || typeof values.keyProvider !== "function" || typeof values.dispose !== "function") throw portError("project identity context capability is invalid", "OFFICIAL_CORE_PROJECT_CONTEXT_INVALID");
  } catch (error) {
    bestEffortDisposeOwnContext(context);
    throw error;
  }
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    values.dispose.call(context);
  };
  const wrapped = Object.create(null);
  for (const field of fields) Object.defineProperty(wrapped, field, { value: field === "dispose" ? dispose : values[field], enumerable: false, configurable: false, writable: false });
  if (JSON.stringify(wrapped) !== "{}" || JSON.stringify(values.execution) !== "{}") {
    dispose();
    throw portError("Host execution capability must not be serializable", "OFFICIAL_CORE_EXECUTION_SERIALIZABLE");
  }
  return Object.freeze(wrapped);
}
function canonicalProjectKey(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) throw portError("canonical project key is invalid", "OFFICIAL_CORE_PROJECT_CONTEXT_INVALID");
  return value;
}
function assertPublicInput(value, field = "request", seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return;
  if (typeof value !== "object" || seen.has(value)) throw portError(`${field} must be acyclic lossless JSON data`, "OFFICIAL_CORE_RAW_INPUT_FORBIDDEN");
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if ((!array && prototype !== Object.prototype && prototype !== null) || (array && prototype !== Array.prototype)) throw portError(`${field} must use a plain JSON prototype`, "OFFICIAL_CORE_RAW_INPUT_FORBIDDEN");
  seen.add(value);
  try {
    if (array) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) throw portError(`${field} contains a sparse array`, "OFFICIAL_CORE_RAW_INPUT_FORBIDDEN");
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined || !("value" in descriptor) || descriptor.enumerable !== true) throw portError(`${field}[${index}] is not an enumerable data property`, "OFFICIAL_CORE_RAW_INPUT_FORBIDDEN");
        assertPublicInput(descriptor.value, `${field}[${index}]`, seen);
      }
      if (Reflect.ownKeys(value).some((key) => key !== "length" && (!/^(?:0|[1-9][0-9]*)$/u.test(String(key)) || Number(key) >= value.length))) throw portError(`${field} contains non-JSON array properties`, "OFFICIAL_CORE_RAW_INPUT_FORBIDDEN");
      return;
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") throw portError(`${field} contains a symbol`, "OFFICIAL_CORE_RAW_INPUT_FORBIDDEN");
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined || !("value" in descriptor) || descriptor.enumerable !== true) throw portError(`${field}.${key} is not an enumerable data property`, "OFFICIAL_CORE_RAW_INPUT_FORBIDDEN");
      const normalized = key.replaceAll(/[-_]/gu, "").toLowerCase();
      if (RAW_PUBLIC_KEYS.has(normalized)) throw portError(`${field} contains forbidden raw Host input ${key}`, "OFFICIAL_CORE_RAW_INPUT_FORBIDDEN");
      assertPublicInput(descriptor.value, `${field}.${key}`, seen);
    }
  } finally { seen.delete(value); }
}
function recoveryInput(input, { reconciliation = false } = {}) {
  if (!isRecord(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw portError("recovery input must be a plain object", "OFFICIAL_CORE_RECOVERY_INPUT_INVALID");
  const allowed = new Set(["confirm", "expectedRevision", "operation", "outcome", "autoRetryUnknown", ...(reconciliation ? ["resolution"] : [])]);
  const values = Object.create(null);
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string" || !allowed.has(key)) throw portError("recovery input contains unsupported control fields", "OFFICIAL_CORE_RECOVERY_INPUT_INVALID");
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined || !("value" in descriptor) || descriptor.enumerable !== true) throw portError(`recovery control ${key} must be an enumerable own data property`, "OFFICIAL_CORE_RECOVERY_INPUT_INVALID");
    values[key] = descriptor.value;
  }
  if (values.confirm !== true) throw portError("recovery requires explicit direct-human confirmation", "OFFICIAL_CORE_RECOVERY_CONFIRMATION_REQUIRED");
  if (!Number.isSafeInteger(values.expectedRevision) || values.expectedRevision < 0) throw portError("recovery expected revision is required", "OFFICIAL_CORE_RECOVERY_REVISION_REQUIRED");
  if (typeof values.operation !== "function") throw portError("recovery Host operation is required", "OFFICIAL_CORE_PROVIDER_INCOMPLETE");
  if (values.autoRetryUnknown === true) throw portError("unknown recovery outcomes can never be auto-retried", "OFFICIAL_CORE_UNKNOWN_OUTCOME_REQUIRES_RECONCILIATION");
  if (!reconciliation && values.outcome === "outcome_unknown") throw portError("unknown recovery outcomes require explicit observer-first reconciliation", "OFFICIAL_CORE_UNKNOWN_OUTCOME_REQUIRES_RECONCILIATION");
  if (reconciliation && (typeof values.resolution !== "string" || values.resolution.trim() === "")) throw portError("reconciliation requires an explicit observer-first resolution", "OFFICIAL_CORE_RECOVERY_RESOLUTION_REQUIRED");
  return Object.freeze({ confirm: true, expectedRevision: values.expectedRevision, operation: values.operation, ...(values.outcome === undefined ? {} : { outcome: values.outcome }), ...(values.autoRetryUnknown === undefined ? {} : { autoRetryUnknown: values.autoRetryUnknown }), ...(reconciliation ? { resolution: values.resolution.trim() } : {}) });
}

function createCustomOfficialCoreProvider(adapters) {
  const normalizedAdapters = normalizeAdapters(adapters);
  return Object.freeze({
    id: "custom-authoritative-v12",
    kind: "custom",
    role: "primary",
    schemaVersion: 12,
    storageMode: "sqlite-wal",
    baseline: OFFICIAL_CORE_BASELINE,
    capabilities: Object.freeze(Object.fromEntries(CAPABILITIES.map((capability) => [capability, true]))),
    adapters: normalizedAdapters,
  });
}

function createOfficialCorePorts({ providers } = {}) {
  if (!Array.isArray(providers) || providers.length === 0) throw portError("one custom primary provider is required", "OFFICIAL_CORE_PRIMARY_REQUIRED");
  const normalized = providers.map(normalizeProvider);
  const primaries = normalized.filter((provider) => provider.role === "primary");
  if (primaries.length > 1) throw portError("multiple primary providers are forbidden", "OFFICIAL_CORE_MULTIPLE_PRIMARY");
  if (primaries.length !== 1 || primaries[0].kind !== "custom") throw portError("one custom primary provider is required", "OFFICIAL_CORE_PRIMARY_REQUIRED");
  const primary = primaries[0];
  const metadata = Object.freeze({ id: primary.id, kind: primary.kind, role: primary.role, schemaVersion: primary.schemaVersion, storageMode: primary.storageMode, baseline: primary.baseline, capabilities: primary.capabilities });
  const ports = Object.freeze({
    provider: metadata,
    assertPublicInput: (value) => assertPublicInput(value),
    projectIdentity: Object.freeze({
      open: async ({ canonicalProjectKey: key, bindLegacy = false } = {}) => privateContext(await primary.adapters.projectIdentity.open({ canonicalProjectKey: canonicalProjectKey(key), bindLegacy: bindLegacy === true })),
      webEntry: () => primary.adapters.projectIdentity.webEntry(),
    }),
    task: Object.freeze({ bind: (input) => primary.adapters.task.bind(input) }),
    collaboration: Object.freeze({ bind: (input) => primary.adapters.collaboration.bind(input) }),
    projection: Object.freeze({ createWebRuntime: (input) => primary.adapters.projection.createWebRuntime(input) }),
    recovery: Object.freeze({
      continueRoot: (input) => primary.adapters.recovery.continueRoot(recoveryInput(input)),
      recoverMember: (input) => primary.adapters.recovery.recoverMember(recoveryInput(input)),
      reconcileMember: (input) => primary.adapters.recovery.reconcileMember(recoveryInput(input, { reconciliation: true })),
    }),
  });
  VALID_PORT_SETS.add(ports);
  return ports;
}
function isOfficialCorePorts(value) { return isRecord(value) && VALID_PORT_SETS.has(value); }

export { OFFICIAL_CORE_BASELINE, createCustomOfficialCoreProvider, createOfficialCorePorts, isOfficialCorePorts };
