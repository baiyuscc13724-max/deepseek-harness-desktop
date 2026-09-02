const PATCH_MARKER = '// Harness Desktop: make exhausted-goal recovery explicit and action-specific for model callers.'

const DESCRIPTION_ORIGINAL = 'const GET_DESCRIPTION = "Read the current same-session goal, including its exact id/revision, objective, phase, completed continuation rounds, round limit, blocker reason when present, and whether another continuation is armed. Call this before updating a goal.";'
const DESCRIPTION_PATCHED = `${DESCRIPTION_ORIGINAL}\n${PATCH_MARKER}\nconst UPDATE_DESCRIPTION = "Update the exact current goal revision. edit, pause, and resume require a direct top-level human request. During an automatic continuation of the current goal, complete and blocked are also allowed. For pause, resume, or complete, send only goal_id, revision, and action. If roundsStarted is greater than or equal to maxGoalRounds, never call resume first: call edit with a larger total max_goal_rounds, then call resume using the revision returned by edit. max_goal_rounds is the total lifetime cap, not an increment. blocked is rejected before the configured minimum round count; the model remains responsible for judging that the same condition persisted across those rounds and must explain it in blocked_reason.";`

const GUIDANCE_ORIGINAL = 'return `Use goal tools for one long-running completion objective in the current session. create_goal may infer goal intent from a direct human request in any language; do not create a goal for routine single-turn work. Call get_goal before update_goal and copy its exact goal_id and revision. After session resume or fork, an active goal is disarmed: when a human asks to continue or resume in any wording or language, use update_goal action resume to rearm it. Mark complete only when the objective is actually achieved. Mark blocked only after the same blocking condition persists for at least ${blockedAfter} consecutive goal rounds, and report that concrete condition in blocked_reason; difficulty, uncertainty, or useful remaining work is not blocked.`;'
const GUIDANCE_PATCHED = 'return `Use goal tools for one long-running completion objective in the current session. create_goal may infer goal intent from a direct human request in any language; do not create a goal for routine single-turn work. Call get_goal before update_goal and copy its exact goal_id and revision. After session resume or fork, an active goal is disarmed: when a human asks to continue or resume in any wording or language, use update_goal action resume to rearm it. For pause, resume, or complete, send only goal_id, revision, and action; never include objective, max_goal_rounds, or blocked_reason. If roundsStarted is greater than or equal to maxGoalRounds, do not try resume: first call update_goal action edit with max_goal_rounds greater than roundsStarted, then call resume using the revision returned by edit. max_goal_rounds is a total lifetime cap, not a number of extra rounds. Mark complete only when the objective is actually achieved. Mark blocked only after the same blocking condition persists for at least ${blockedAfter} consecutive goal rounds, and report that concrete condition in blocked_reason; difficulty, uncertainty, or useful remaining work is not blocked.`;'

const UPDATE_DESCRIPTION_ORIGINAL = 'description: "Update the exact current goal revision. edit, pause, and resume require a direct top-level human request. During an automatic continuation of the current goal, complete and blocked are also allowed. blocked is rejected before the configured minimum round count; the model remains responsible for judging that the same condition persisted across those rounds and must explain it in blocked_reason.",'
const UPDATE_DESCRIPTION_PATCHED = 'description: UPDATE_DESCRIPTION,'

const ACTION_DESCRIPTION_ORIGINAL = 'description: "edit | pause | resume | complete | blocked"'
const ACTION_DESCRIPTION_PATCHED = 'description: "Choose exactly one action. edit allows objective and/or max_goal_rounds. blocked requires blocked_reason. pause, resume, and complete accept no optional fields. An exhausted goal requires edit to a larger total cap before resume."'

const CAP_DESCRIPTION_ORIGINAL = 'description: "Replacement cap; valid only with action edit."'
const CAP_DESCRIPTION_PATCHED = 'description: "Replacement total lifetime cap; valid only with action edit and never with resume. To continue an exhausted goal, set this greater than roundsStarted, then resume with the returned revision. This is not an increment."'

const RESUME_BRANCH_ORIGINAL = `\t\t\tif (args.action === "pause" || args.action === "resume") {
\t\t\t\trequireDirectHuman(ctx, execution);
\t\t\t\tif (hasText(args.objective) || hasRoundCap(args.max_goal_rounds) || hasText(args.blocked_reason)) throw new HarnessError("objective and max_goal_rounds are valid only with action edit; blocked_reason is valid only with action blocked", "GOAL_TOOL_INVALID_UPDATE");
\t\t\t\tconst goal = args.action === "pause" ? ctx.goals.pause(execution.agent, ref) : ctx.goals.resume(execution.agent, ref);
\t\t\t\treturn Promise.resolve(goalValue(goal));
\t\t\t}`

const RESUME_BRANCH_PATCHED = `\t\t\tif (args.action === "pause" || args.action === "resume") {
\t\t\t\trequireDirectHuman(ctx, execution);
\t\t\t\tif (hasText(args.objective) || hasRoundCap(args.max_goal_rounds) || hasText(args.blocked_reason)) {
\t\t\t\t\tconst current = ctx.goals.get(execution.agent);
\t\t\t\t\tconst exhausted = args.action === "resume" && current !== void 0 && current.id === ref.id && current.revision === ref.revision && current.roundsStarted >= current.maxGoalRounds;
\t\t\t\t\tconst recovery = exhausted ? \` This goal is at its \${current.roundsStarted}/\${current.maxGoalRounds} round limit. First call update_goal with action "edit" and max_goal_rounds greater than \${current.roundsStarted}; then call action "resume" using the returned revision. max_goal_rounds is a total lifetime cap, not an increment.\` : " Omit objective, max_goal_rounds, and blocked_reason, then retry the requested action.";
\t\t\t\t\tthrow new HarnessError(\`action "\${args.action}" accepts only goal_id, revision, and action.\${recovery}\`, "GOAL_TOOL_INVALID_UPDATE");
\t\t\t\t}
\t\t\t\tif (args.action === "pause") return Promise.resolve(goalValue(ctx.goals.pause(execution.agent, ref)));
\t\t\t\ttry {
\t\t\t\t\treturn Promise.resolve(goalValue(ctx.goals.resume(execution.agent, ref)));
\t\t\t\t} catch (error) {
\t\t\t\t\tif (error?.code !== "GOAL_INVALID_TRANSITION" || typeof error.message !== "string" || !error.message.includes(" exhausted ")) throw error;
\t\t\t\t\tconst current = ctx.goals.get(execution.agent);
\t\t\t\t\tconst roundsStarted = current?.roundsStarted;
\t\t\t\t\tconst maxGoalRounds = current?.maxGoalRounds;
\t\t\t\t\tif (!Number.isSafeInteger(roundsStarted) || !Number.isSafeInteger(maxGoalRounds)) throw error;
\t\t\t\t\tthrow new HarnessError(\`goal "\${ref.id}" exhausted its \${roundsStarted}/\${maxGoalRounds} round budget. Do not retry action "resume". First call update_goal with action "edit" and max_goal_rounds greater than \${roundsStarted}; then call action "resume" using the returned revision.\`, "GOAL_TOOL_ROUND_CAP_EXHAUSTED");
\t\t\t\t}
\t\t\t}`

const FRAGMENTS = [
  ['description constants', DESCRIPTION_ORIGINAL, DESCRIPTION_PATCHED],
  ['system guidance', GUIDANCE_ORIGINAL, GUIDANCE_PATCHED],
  ['update tool description', UPDATE_DESCRIPTION_ORIGINAL, UPDATE_DESCRIPTION_PATCHED],
  ['action description', ACTION_DESCRIPTION_ORIGINAL, ACTION_DESCRIPTION_PATCHED],
  ['round-cap description', CAP_DESCRIPTION_ORIGINAL, CAP_DESCRIPTION_PATCHED],
  ['pause/resume execution branch', RESUME_BRANCH_ORIGINAL, RESUME_BRANCH_PATCHED]
]

function replaceExactOnce(source, original, patched, label) {
  const first = source.indexOf(original)
  if (first < 0 || source.indexOf(original, first + original.length) >= 0) {
    throw new Error(`Pinned DSH goal tool ${label} changed; refusing an unsafe recovery-guidance patch.`)
  }
  return source.slice(0, first) + patched + source.slice(first + original.length)
}

export function patchGoalToolRecoverySource(source) {
  const patchedFragments = FRAGMENTS.map(([, , patched]) => patched)
  if (patchedFragments.every(fragment => source.includes(fragment))) return { source, changed: false }
  if (source.includes(PATCH_MARKER) || patchedFragments.some(fragment => source.includes(fragment))) {
    throw new Error('Pinned DSH goal tool recovery-guidance patch is incomplete; refusing an unsafe repair.')
  }
  let output = source
  for (const [label, original, patched] of FRAGMENTS) {
    output = replaceExactOnce(output, original, patched, label)
  }
  if (!patchedFragments.every(fragment => output.includes(fragment))) {
    throw new Error('Pinned DSH goal tool recovery-guidance patch did not compose completely.')
  }
  return { source: output, changed: true }
}
