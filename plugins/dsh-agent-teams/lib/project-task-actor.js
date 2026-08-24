const ACTOR_KINDS = new Set(["human", "agent", "team", "system"]);
const HUMAN_ROLES = new Set(["owner", "maintainer", "contributor", "reviewer", "observer"]);
const NON_HUMAN_AUTHORITIES = new Set(["project_lead", "reviewer"]);

function actorError(message, code = "PROJECT_TASK_ACTOR_UNRESOLVED") {
  const error = new Error(message);
  error.code = code;
  return error;
}
function nonEmptyString(value, field, max = 256) {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) throw new TypeError(`${field} must be a non-empty string of at most ${max} characters`);
  return value.trim();
}
function normalizeResolvedActor(value, expectedProjectRef) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw actorError("trusted execution did not resolve to a project actor");
  const projectRef = nonEmptyString(value.projectRef, "resolved actor projectRef");
  if (projectRef !== expectedProjectRef) throw actorError("trusted execution resolved for another project");
  const actorRef = nonEmptyString(value.actorRef, "resolved actorRef");
  const kind = nonEmptyString(value.kind, "resolved actor kind", 32);
  if (!ACTOR_KINDS.has(kind)) throw new TypeError("resolved actor kind is unsupported");
  const actor = { projectRef, actorRef, kind };
  if (kind === "human") {
    const role = nonEmptyString(value.role, "resolved human role", 32);
    if (!HUMAN_ROLES.has(role)) throw new TypeError("resolved human role is unsupported");
    actor.role = role;
  } else {
    const authorities = value.authorities ?? [];
    if (!Array.isArray(authorities) || authorities.some((authority) => !NON_HUMAN_AUTHORITIES.has(authority)) || new Set(authorities).size !== authorities.length) {
      throw new TypeError("resolved non-human authorities are unsupported");
    }
    actor.authorities = [...authorities];
  }
  return Object.freeze(actor);
}

class TrustedProjectActorResolver {
  constructor(resolveActor) {
    if (typeof resolveActor !== "function") throw new TypeError("actorResolver must be a function");
    this.resolveActor = resolveActor;
  }

  resolve(execution, projectRef) {
    nonEmptyString(projectRef, "projectRef");
    if (execution === undefined || execution === null) throw actorError("trusted execution context is required");
    return normalizeResolvedActor(this.resolveActor(execution, projectRef), projectRef);
  }
}

export { TrustedProjectActorResolver, normalizeResolvedActor };
