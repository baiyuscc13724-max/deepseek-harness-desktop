import net from "node:net";

const ENDPOINT_ENV = "HARNESS_DESKTOP_AUTHORIZATION_ENDPOINT";
const TOKEN_ENV = "HARNESS_DESKTOP_AUTHORIZATION_TOKEN";
const MAX_RESPONSE_BYTES = 64 * 1024;
const ERROR_CODES = Object.freeze({
  HOST_AUTHORIZATION_REPLAY: "AGENT_TEAMS_HOST_AUTHORIZATION_REPLAY",
  HOST_AUTHORIZATION_DENIED: "AGENT_TEAMS_HOST_AUTHORIZATION_DENIED",
  HOST_AUTHORIZATION_INVALID: "AGENT_TEAMS_HOST_AUTHORIZATION_INVALID",
  HOST_AUTHORIZATION_STATE_INVALID: "AGENT_TEAMS_HOST_AUTHORIZATION_UNAVAILABLE",
  HOST_AUTHORIZATION_CAPACITY: "AGENT_TEAMS_HOST_AUTHORIZATION_CAPACITY",
  HOST_AUTHORIZATION_EXPIRED: "AGENT_TEAMS_HOST_AUTHORIZATION_EXPIRED",
  HOST_AUTHORIZATION_REVOKED: "AGENT_TEAMS_HOST_AUTHORIZATION_REVOKED",
  HOST_AUTHORIZATION_MISMATCH: "AGENT_TEAMS_HOST_AUTHORIZATION_MISMATCH",
});

function capabilityError(code = "AGENT_TEAMS_HOST_AUTHORIZATION_UNAVAILABLE") {
  const error = new Error("Desktop Host authorization is unavailable");
  error.code = code;
  return error;
}
function validEndpoint(value, platform = process.platform) {
  if (typeof value !== "string" || value.length === 0 || value.length > 1024 || value.includes("\0")) return false;
  return platform === "win32" ? value.startsWith("\\\\.\\pipe\\dsh-agent-teams-authorization-") : value.startsWith("/");
}
function unavailableCapability() {
  const unavailable = () => Promise.reject(capabilityError());
  return Object.freeze({
    available: false,
    consumeResolveUnknown: unavailable,
    consumeAutopilotAuthorization: unavailable,
    readAutopilotAuthorizationState: unavailable,
    revokeAutopilotAuthorizations: unavailable,
    dispose: () => false,
  });
}
function consumeDesktopAuthorizationCapability({ env = process.env, connect = net.createConnection, platform = process.platform, timeoutMs = 130_000 } = {}) {
  let endpoint;
  let tokenText;
  let cleared = true;
  try { endpoint = env?.[ENDPOINT_ENV]; tokenText = env?.[TOKEN_ENV]; } catch { cleared = false; }
  finally {
    if (env !== null && typeof env === "object") for (const key of [ENDPOINT_ENV, TOKEN_ENV]) {
      try { if (!Reflect.deleteProperty(env, key)) cleared = false; } catch { cleared = false; }
    }
  }
  let token;
  try { token = Buffer.from(tokenText ?? "", "base64url"); } catch {}
  if (!cleared || !validEndpoint(endpoint, platform) || token?.length !== 32 || token.toString("base64url") !== tokenText) {
    token?.fill(0);
    return unavailableCapability();
  }
  let disposed = false;
  const invoke = (action, request, resultKey) => new Promise((resolve, reject) => {
    if (disposed) return reject(capabilityError());
    const socket = connect(endpoint);
    let response = "";
    let bytes = 0;
    let settled = false;
    const finish = callback => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => socket.destroy(capabilityError()), timeoutMs);
    const fail = () => finish(() => reject(capabilityError()));
    socket.setEncoding("utf8");
    socket.once("connect", () => socket.write(`${JSON.stringify({ action, token: token.toString("base64url"), request })}\n`));
    socket.on("data", chunk => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_RESPONSE_BYTES) return socket.destroy(capabilityError());
      response += chunk;
    });
    socket.once("error", fail);
    socket.once("end", () => finish(() => {
      let parsed;
      try { parsed = JSON.parse(response.trim()); } catch { return reject(capabilityError()); }
      if (parsed?.ok === true && parsed[resultKey] && typeof parsed[resultKey] === "object") return resolve(parsed[resultKey]);
      reject(capabilityError(ERROR_CODES[parsed?.code] ?? "AGENT_TEAMS_HOST_AUTHORIZATION_UNAVAILABLE"));
    }));
  });
  const consumeResolveUnknown = request => invoke("consumeResolveUnknown", request, "receipt");
  const consumeAutopilotAuthorization = request => invoke("consumeAutopilotAuthorization", request, "receipt");
  const readAutopilotAuthorizationState = () => invoke("readAutopilotAuthorizationState", undefined, "state");
  const revokeAutopilotAuthorizations = request => invoke("revokeAutopilotAuthorizations", request, "state");
  const dispose = () => {
    if (disposed) return false;
    disposed = true;
    token.fill(0);
    return true;
  };
  const capability = { available: true };
  Object.defineProperties(capability, {
    consumeResolveUnknown: { value: consumeResolveUnknown },
    consumeAutopilotAuthorization: { value: consumeAutopilotAuthorization },
    readAutopilotAuthorizationState: { value: readAutopilotAuthorizationState },
    revokeAutopilotAuthorizations: { value: revokeAutopilotAuthorizations },
    dispose: { value: dispose },
    toJSON: { value: () => ({ available: true }) },
  });
  return Object.freeze(capability);
}

export { ENDPOINT_ENV, TOKEN_ENV, consumeDesktopAuthorizationCapability };
