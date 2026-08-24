import path from "node:path";
import { realpath, stat } from "node:fs/promises";

const GIT_AUTHORITY_COMMAND_ENV = "HARNESS_DESKTOP_GIT_AUTHORITY_COMMAND";
const GIT_AUTHORITY_ROOT_ENV = "HARNESS_DESKTOP_GIT_AUTHORITY_ROOT";

function capabilityError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}
function platformPath(platform) { return platform === "win32" ? path.win32 : path; }
function isSameOrWithinGitRoot(root, candidate, platform = process.platform) {
  const p = platformPath(platform);
  const normalizedRoot = p.resolve(root);
  const normalizedCandidate = p.resolve(candidate);
  if (platform === "win32") {
    const rootKey = normalizedRoot.toLowerCase();
    const candidateKey = normalizedCandidate.toLowerCase();
    return candidateKey === rootKey || candidateKey.startsWith(`${rootKey}${p.sep}`);
  }
  const relative = p.relative(normalizedRoot, normalizedCandidate);
  return relative === "" || (!p.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${p.sep}`));
}
function privateCapability(command, root) {
  const capability = {};
  Object.defineProperties(capability, {
    gitCommand: { value: command, enumerable: false },
    allowedGitRoot: { value: root, enumerable: false },
    toJSON: { value: () => ({ available: true }), enumerable: false },
  });
  return Object.freeze(capability);
}

async function validateDesktopGitCapability({ command, root, platform = process.platform, realpathImpl = realpath, statImpl = stat } = {}) {
  const p = platformPath(platform);
  if (typeof command !== "string" || typeof root !== "string" || !p.isAbsolute(command) || !p.isAbsolute(root)) {
    throw capabilityError("the Host Git authority capability is invalid", "PROJECT_FOUNDATION_GIT_UNTRUSTED");
  }
  let realCommand;
  let realRoot;
  try {
    [realCommand, realRoot] = await Promise.all([realpathImpl(command), realpathImpl(root)]);
  } catch {
    throw capabilityError("the Host Git authority capability is unavailable", "PROJECT_FOUNDATION_GIT_UNTRUSTED");
  }
  if (typeof realCommand !== "string" || typeof realRoot !== "string" || !p.isAbsolute(realCommand) || !p.isAbsolute(realRoot)) {
    throw capabilityError("the Host Git authority capability did not resolve to absolute paths", "PROJECT_FOUNDATION_GIT_UNTRUSTED");
  }
  let commandStat;
  let rootStat;
  try {
    [commandStat, rootStat] = await Promise.all([statImpl(realCommand), statImpl(realRoot)]);
  } catch {
    throw capabilityError("the Host Git authority capability cannot be inspected", "PROJECT_FOUNDATION_GIT_UNTRUSTED");
  }
  if (typeof commandStat?.isFile !== "function" || !commandStat.isFile() || typeof rootStat?.isDirectory !== "function" || !rootStat.isDirectory()) {
    throw capabilityError("the Host Git authority capability has invalid filesystem types", "PROJECT_FOUNDATION_GIT_UNTRUSTED");
  }
  if (!/^git(?:\.exe)?$/iu.test(p.basename(realCommand)) || !isSameOrWithinGitRoot(realRoot, realCommand, platform)) {
    throw capabilityError("the Host Git executable is outside its trusted runtime root", "PROJECT_FOUNDATION_GIT_UNTRUSTED");
  }
  return privateCapability(realCommand, realRoot);
}

function consumeDesktopGitCapability({ env = process.env, platform = process.platform, realpathImpl = realpath, statImpl = stat } = {}) {
  let command;
  let root;
  let readable = true;
  let cleared = true;
  try {
    command = env?.[GIT_AUTHORITY_COMMAND_ENV];
    root = env?.[GIT_AUTHORITY_ROOT_ENV];
  } catch {
    readable = false;
  } finally {
    if (env !== null && typeof env === "object") {
      for (const key of [GIT_AUTHORITY_COMMAND_ENV, GIT_AUTHORITY_ROOT_ENV]) {
        try { if (!Reflect.deleteProperty(env, key)) cleared = false; }
        catch { cleared = false; }
      }
    }
  }
  if (!readable || !cleared) return Promise.reject(capabilityError("the Host Git authority environment could not be consumed", "PROJECT_FOUNDATION_GIT_UNTRUSTED"));
  if (typeof command !== "string" || command.trim() === "" || typeof root !== "string" || root.trim() === "") {
    return Promise.reject(capabilityError("the Desktop Host did not provide a Git authority capability", "PROJECT_FOUNDATION_GIT_UNAVAILABLE"));
  }
  return validateDesktopGitCapability({ command: command.trim(), root: root.trim(), platform, realpathImpl, statImpl });
}

export {
  GIT_AUTHORITY_COMMAND_ENV,
  GIT_AUTHORITY_ROOT_ENV,
  consumeDesktopGitCapability,
  isSameOrWithinGitRoot,
  validateDesktopGitCapability,
};
