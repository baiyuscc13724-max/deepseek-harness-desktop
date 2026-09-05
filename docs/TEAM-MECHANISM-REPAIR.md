# Team mechanism repair — 1.0.60 source checkpoint

## Fixed scope

Only scope-growth reminders, event-driven quiet waiting, and cancel/close after Stop without restarting workers, followed by the official release. Abandoned browser, OSR, preview and other changes were not copied into the isolated candidate. The base is stable `c132491` (1.0.59); the original working tree remains untouched and the old team remains paused.

## Implementation

- `projectTeamScope` derives counts at first successful worker publication vs later additions. Missing historical timestamps remain unknown. Status, task creation and a static UI note distinguish internal task counts from user requirements/approval. Prompt guidance requires scope comparison and deferring unrelated discoveries.
- `team_status.wait_for_change=true` silently holds the current cancellable tool turn on one subscription per root. No polling timer, Goal API, grant creation or worker wake. Duplicate/checkpoint-only updates do not finish it. Durable changes return current state; no producer returns attention in the same turn. Stop/abort/disposal and setup failure clean up. Exact root/project/ownership fences are checked across asynchronous result reads.
- Public paused cleanup permission comes only from the exact live root's direct-human turn, never a model parameter. Cancellation retains OCC/epoch/history. Whole-team cleanup drains members without a retirement prompt or Resume; failure remains paused and a newer Stop rejects stale closure.

## Source gate evidence

- Team serial regression: 535 passed, 0 failed, 2 existing conditional skips. Initial concurrent performance contention was not hidden: unchanged 60ms cold-projection threshold passed in isolation (32.249ms) and serially (31.250ms).
- Added paused-worker graceful/force drain, failed drain and racing Stop checks passed. Scope/wait tests including setup-failure cleanup: 8/8; actual tool lifecycle and paused-worker targeted checks: 2/2.
- Final `npm run verify`: static verification passed; 303 test files ran exactly once through the repository runner. Ordinary phase 2368 passed, 29 skipped; isolated timing phase 152 passed, 3 skipped; zero failures. Conditional historical/packaged/cloud tests are not claimed as passed.
- `npm run verify:release`: passed. Version synchronization checks passed for all 15 owned plugins and mobile metadata; the independently versioned Android plugin stays unchanged. No functional browser/mobile changes were added by metadata synchronization.
- Canonical candidate hashes and review boundaries are in `SECURITY-REVIEW-v1.0.60.zh-CN.md`. Historical 1.0.59 maps/review are unchanged; the exact reviewed successor has its own freeze checks rather than overwriting old acceptance.

## Publication boundary

At this source checkpoint, cloud builds and publication are still pending. Only `npm run release:publish -- run --version 1.0.60` may perform them; `status` reads its durable evidence and the same `run` resumes. No local binary upload, manual tag creation, asset replacement or early stable promotion is permitted. Release completion must be verified from publisher evidence, not inferred from these source tests.
