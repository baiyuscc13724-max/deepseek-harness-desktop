# Long-session performance benchmark

Harness Desktop uses two complementary regression layers: a repeatable synthetic Electron stress fixture for quantitative budgets, plus production-contract suites that execute the real runtime patches and desktop lifecycle paths. Neither layer is sufficient alone.

## Commands

```powershell
# Full baseline / release-candidate comparison
npm run benchmark:session

# Short local diagnostic
npm run benchmark:session:quick

# Required two-layer gate: synthetic Electron budget, then production contracts
npm run test:performance

# Run either layer while investigating a failure
npm run test:performance:synthetic
npm run test:performance:product
```

Add `-- --json` to either npm benchmark command when machine-readable output is needed. The command exits with code `2` when a budget fails and `1` when the fixture cannot run.

## Evidence layers

### 1. Synthetic quantitative budget

`test:performance:synthetic` starts the pinned Electron runtime with an isolated profile and measures a deterministic large logical history. It provides comparable timing, heap, listener, and `longtask` numbers without touching a user's account. Because its conversation DOM is purpose-built, a synthetic PASS proves budget stability only; it does **not** by itself prove the production DSH patches improved.

### 2. Production-contract gate

`test:performance:product` executes the repository's real product code and guarded patch contracts:

- session-list metadata projection and bounded artifact concurrency;
- session persistence field projection and restoration behavior;
- conversation work-tree grouping, bounded batches, selected-call behavior, and large transcript contracts;
- session-experience plugin subscription/observer/listener cleanup across repeated remounts;
- renderer observer scheduling on real `renderer/app.js` source;
- right-workspace coalescing, hidden refresh suspension, and production integration contracts.

`test:performance` passes only when the synthetic budget **and** every production-contract suite pass. This binds the numerical smoke signal to actual shipped patch/lifecycle behavior while keeping the two kinds of evidence explicit.

## Workload and measurements

The full fixture creates eight sessions with 1,200 alternating user/tool/assistant rows each (9,600 logical messages), keeps a bounded 240-row conversation DOM, warms up with 20 switches, measures another 180 switches, and exercises 120 top/bottom scroll changes. It records:

- first conversation open time;
- median, p95, and maximum session-switch time;
- median, p95, and maximum synchronous scroll handling/layout time;
- renderer heap after warm-up, final heap, peak heap, and retained growth after GC;
- active listener count after warm-up and after cleanup;
- Chromium `longtask` count, maximum, and total duration.

The fixture uses the repository's pinned Electron/Chromium runtime and an isolated temporary profile. It never starts a replacement GUI service and never reads or changes a real user's conversations. Its DOM lifecycle models the production requirements that matter for regression gating: a large logical history, bounded rendered rows, repeat switching, cleanup of per-session listeners, scroll/layout work, and retained-memory behavior.

## Budgets

Timing ceilings combine a small same-run DOM calibration with conservative absolute floors, so a slower CI machine is not rejected solely for being slower. Leak signals retain strict independent limits.

| Signal | Failure threshold |
| --- | --- |
| First open | `> max(350 ms on Windows cloud / 180 ms elsewhere, calibration p95 × 18)` |
| Switch p95 | `> max(90 ms, calibration p95 × 12)` |
| Scroll p95 | `> max(50 ms, calibration p95 × 8)` |
| Retained heap growth | `> max(24 MiB, warm heap × 35%)` |
| Listener growth | `> 2` |
| Longest main-thread task | `> max(350 ms on Windows cloud / 200 ms elsewhere, calibration p95 × 24)` |
| Long-task rate | `> 15%` of measured switches |

The Windows-only cold-paint floors bound one-time Defender/DLL startup work observed on the pinned GitHub image; they do not relax switch p95, scroll p95, leak, listener, or long-task-rate gates, and a delay above 350 ms still fails. The generous timing floors are safety limits rather than claims that those latencies are desirable. Trends should be compared on the same machine and pinned Electron version; heap/listener/long-task gates catch linear lifecycle regressions even when CPU speed differs.

## Recorded same-machine runs

Environment: Windows x64, Electron 43.2.0, Chromium 150.0.7871.129. Scenario: 8 × 1,200 messages, 240 rendered rows, 180 measured switches, 120 scroll samples.

| Metric | Current baseline (2026-08-29 10:01) | Interim retest (2026-08-29 10:08) | Final rerun |
| --- | ---: | ---: | ---: |
| Calibration p95 | 0.2 ms | 0.4 ms | 0.2 ms |
| First open | 16.4 ms | 26.5 ms | 21.4 ms |
| Switch median | 2.6 ms | 2.4 ms | 4.3 ms |
| Switch p95 | 4.7 ms | 3.9 ms | 9.5 ms |
| Switch max | 9.0 ms | 8.7 ms | 29.7 ms |
| Scroll median | 0.0 ms | 0.0 ms | 0.0 ms |
| Scroll p95 | 0.1 ms | 0.1 ms | 0.1 ms |
| Heap after warm-up | 2.830 MiB | 2.831 MiB | 2.831 MiB |
| Final heap | 2.742 MiB | 2.743 MiB | 2.752 MiB |
| Retained heap growth | -0.088 MiB | -0.088 MiB | -0.078 MiB |
| Peak heap | 3.290 MiB | 3.291 MiB | 3.291 MiB |
| Listener growth | 0 (cleanup reaches 0) | 0 (cleanup reaches 0) | 0 (cleanup reaches 0) |
| Long tasks | 0; max 0 ms | 0; max 0 ms | 6; max 91 ms; rate 3.3% |
| Synthetic budget | PASS | PASS | PASS |
| Production-contract gate | not yet bound | 31/31 targeted PASS | 31/31 PASS |

The 10:08 run remains labeled interim because deeper selected-call and node-store review was still outstanding. The final frozen run was recorded only after the second durable frontend completion. Synthetic switch timings were noisier than baseline (p95 9.5 ms versus 4.7 ms) and six long tasks appeared, but every value remained inside the declared Windows limits: p95 switch 9.5/90 ms, longest task 91/350 ms, task rate 3.3/15%, no retained heap growth, and no listener growth. This is an honest budget PASS, not a claim that every synthetic timing improved.

## Product-integrated optimization evidence

The production-contract layer is the evidence that the shipped runtime paths improved rather than only the synthetic DOM:

| Production path | Before | After | Result |
| --- | ---: | ---: | ---: |
| Large message-tree projection | 150.828 ms | 1.128 ms | 133.7× faster |
| Collapsed 4,000-step DOM | 4,000 eager rows | 0 eager prefix rows; first batch 64 | bounded |
| Session field projection | 113.540 ms | 0.436 ms | 260.4× faster |
| 160 session artifacts | 2,457.747 ms | 279.330 ms | 8.8× faster |
| Two-layer final gate | synthetic only | synthetic 3/3 + product 31/31 | PASS |

The final conversation contracts also prove that a deeply nested selected call remains reachable in the first bounded 64-item priority window and that memoization follows the mutable node-store content snapshot instead of a stale container reference. Do not compare different scenario sizes or Electron versions as an optimization claim.
