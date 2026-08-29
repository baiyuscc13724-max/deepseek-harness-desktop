import net from "node:net";

const ENDPOINT_ENV = "HARNESS_DESKTOP_SECRET_ENDPOINT";
const TOKEN_ENV = "HARNESS_DESKTOP_SECRET_TOKEN";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function capabilityError(message, code = "PROJECT_ENTRY_SECRET_UNAVAILABLE") {
  const error = new Error(message);
  error.code = code;
  return error;
}
function boundedString(value, field, max) {
  if (typeof value !== "string" || value.length === 0 || value.length > max) throw capabilityError(`${field} is invalid`, "PROJECT_ENTRY_SECRET_INVALID");
  return value;
}
function validEndpoint(value, platform = process.platform) {
  if (typeof value !== "string" || value.length === 0 || value.length > 1024 || value.includes("\0")) return false;
  return platform === "win32" ? value.startsWith("\\\\.\\pipe\\dsh-agent-teams-secret-") : value.startsWith("/");
}

function consumeDesktopSecretCapability({ env = process.env, connect = net.createConnection, platform = process.platform, timeoutMs = 5_000 } = {}) {
  let endpoint;
  let tokenText;
  let cleared = true;
  try {
    endpoint = env?.[ENDPOINT_ENV];
    tokenText = env?.[TOKEN_ENV];
  } catch {
    cleared = false;
  } finally {
    if (env !== null && typeof env === "object") {
      for (const key of [ENDPOINT_ENV, TOKEN_ENV]) {
        try { if (!Reflect.deleteProperty(env, key)) cleared = false; } catch { cleared = false; }
      }
    }
  }
  let token;
  try { token = Buffer.from(tokenText ?? "", "base64url"); } catch {}
  if (!cleared || !validEndpoint(endpoint, platform) || token?.length !== 32 || token.toString("base64url") !== tokenText) {
    token?.fill(0);
    return Object.freeze({ available: false, protect: async () => { throw capabilityError("the Desktop Host secret capability is unavailable"); }, unprotect: async () => { throw capabilityError("the Desktop Host secret capability is unavailable"); }, dispose: () => false });
  }
  let disposed = false;
  const request = message => new Promise((resolve, reject) => {
    if (disposed) return reject(capabilityError("the Desktop Host secret capability is closed"));
    const socket = connect(endpoint);
    let response = "";
    let bytes = 0;
    const timer = setTimeout(() => socket.destroy(capabilityError("the Desktop Host secret capability timed out")), timeoutMs);
    const finish = error => {
      clearTimeout(timer);
      if (error) reject(capabilityError("the Desktop Host secret capability is unavailable"));
    };
    socket.setEncoding("utf8");
    socket.once("connect", () => socket.write(`${JSON.stringify({ ...message, token: token.toString("base64url") })}\n`));
    socket.on("data", chunk => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_RESPONSE_BYTES) return socket.destroy(capabilityError("Host secret response exceeded its limit"));
      response += chunk;
    });
    socket.once("error", finish);
    socket.once("end", () => {
      clearTimeout(timer);
      let parsed;
      try { parsed = JSON.parse(response.trim()); } catch { return reject(capabilityError("the Desktop Host secret response is invalid")); }
      if (parsed?.ok !== true) return reject(capabilityError("the Desktop Host could not open project secrets", parsed?.code === "HOST_SECRET_INVALID" ? "PROJECT_ENTRY_SECRET_INVALID" : "PROJECT_ENTRY_SECRET_UNAVAILABLE"));
      resolve(parsed);
    });
  });
  const protect = async (plaintext, { purpose, binding } = {}) => {
    if (!Buffer.isBuffer(plaintext)) throw new TypeError("plaintext must be a Buffer");
    const result = await request({ action: "protect", purpose: boundedString(purpose, "purpose", 128), binding: boundedString(binding, "binding", 512), plaintext: plaintext.toString("base64") });
    return boundedString(result.sealed, "sealed", MAX_RESPONSE_BYTES);
  };
  const unprotect = async (sealed, { purpose, binding } = {}) => {
    const result = await request({ action: "unprotect", purpose: boundedString(purpose, "purpose", 128), binding: boundedString(binding, "binding", 512), sealed: boundedString(sealed, "sealed", MAX_RESPONSE_BYTES) });
    const plaintext = Buffer.from(boundedString(result.plaintext, "plaintext", MAX_RESPONSE_BYTES), "base64");
    if (plaintext.toString("base64") !== result.plaintext) {
      plaintext.fill(0);
      throw capabilityError("the Desktop Host secret response is invalid", "PROJECT_ENTRY_SECRET_INVALID");
    }
    return plaintext;
  };
  const dispose = () => {
    if (disposed) return false;
    disposed = true;
    token.fill(0);
    return true;
  };
  const capability = { available: true };
  Object.defineProperties(capability, { protect: { value: protect }, unprotect: { value: unprotect }, dispose: { value: dispose }, toJSON: { value: () => ({ available: true }) } });
  return Object.freeze(capability);
}

export { ENDPOINT_ENV, TOKEN_ENV, consumeDesktopSecretCapability };
