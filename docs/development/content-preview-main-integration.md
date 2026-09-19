# Source-bound preview and native file-open main integration

## Scope and ownership

Recovery member 控制续作 authored only the preview/context-menu/main IPC portion of `electron/main.cjs` and this document. Browser upload rework was already accepted separately; it was not rewritten. `right-workspace-service`, desktop-files, renderer/app/session-experience and integration UI belong to other team members. No test files, installed runtime, user configuration, commit or release were changed here. This is author self-review, not independent security certification.

## Interface contract

| Entry | Accepted value | Behavior |
| --- | --- | --- |
| workspace-link preview | `{ target, sessionId, sourceKind: 'workspace-link' }` | Exact source-bound `filePreview` resource request. |
| workspace-link system open/reveal | same object | Exact source-bound content request, safely materialized to private temp, native file policy unchanged. |
| legacy file-list system open | `{ path, name, sessionId }` (matching `target` allowed) | Preserve snapshot source; never ambient active session. |
| explicit local preview | `{ target }` or legacy explicit local string | Require an absolute local target; return `{ file }`. A sourceKind/sessionId/path property prevents falling into this branch. |
| guest context menu | recent matching clicked-link snapshot | Host extracts only `{ target, sessionId, sourceKind }`; no raw href/srcURL absolute-path bypass. |

`rightWorkspaceFileSource` copies primitives into a frozen source record before any await. Unknown source kinds, blank/oversize/control-character session IDs or targets, conflicting target/path fields, and missing provenance fail with `RIGHT_WORKSPACE_BAD_SOURCE`. Literal Unicode, `%20`, `#` and `+` are not decoded by the source normalizer. Source workspace identity, session lineage/existence, path containment and symlink checks remain in the existing runtime desktop-files service, reached through fixed right-workspace resource URLs. No workspace is scanned or inferred from `desktopRuntimePaths().workspace`.

`rightWorkspace:previewLocal` / `rightWorkspace:openFile` still start with `assertDesktopShellSender`. They call shared helpers also used by context menus, avoiding divergent native-open and preview resolution. Content requests contain the same source session and target as preview; native open receives only the safely materialized copy. Existing executable/reveal policy, exclusive temporary file creation and cleanup remain in effect.

The guest script requires a finite snapshot age in `[0, 5000)` ms, `sourceKind='workspace-link'`, and exact equality between snapshot value and the element at the context point. Expired/future/mismatched snapshots and raw absolute file links without source metadata yield no local menu. Menu closures retain the frozen event source even if the selected session or global snapshot changes while the menu is open. Labels describe the actual behavior: system application, safe copy reveal, copy file reference. They do not misleadingly promise opening the original project directory.

## Literal local path issue found during validation

The initial integration fixture used `中文 #50%20 +.txt`. It found `openLocalTarget(file.destination)` re-decoded `%20` into a space and attempted a different nonexistent path. Fixed this in the main-owned seam, not by editing another member's service: pass `pathToFileURL(file.destination).href`, then assert the existing normalizer maps back to that exact destination before opening. Explicit absolute local preview paths also use a file URL to preserve literal percent characters. Paths that the legacy normalizer would further reinterpret (for example a materialized basename looking like a line suffix) fail closed with `RIGHT_WORKSPACE_BAD_LOCAL_PATH`, rather than open a neighboring file.

## New executed evidence — 2026-09-05

1. Temporary `content-preview-main-fixture.cjs`: **11 scenarios passed, exit 0**. It extracts the actual main functions and uses the actual right-workspace service, actual registered desktop-files HTTP handlers, two real temporary workspaces, real file reads and safe-copy materialization. It verifies:
   - source A preview and system-open bytes are identical, while same-named source B bytes do not leak;
   - literal Chinese/space/#/%20/+ name preserved at native-open handoff;
   - mutating input session/target at the fetch await cannot switch the frozen request;
   - missing/invalid source, unknown session, and an absolute source-B path under source A are denied for preview/open;
   - legacy file-list snapshot still opens source A;
   - explicit local preview has the expected `{file}` envelope;
   - guest raw absolute path has no bypass;
   - context menu created for A still previews/opens A after mutable recent snapshot switches to B;
   - expired, future and pointed-target-mismatched snapshots return null.
2. `node --test tests/right-workspace-service.test.cjs tests/desktop-files.test.cjs tests/workspace-links-interaction.test.cjs`: **22/24 pass, exit 1**. All service/desktop-files tests pass. Two existing context-menu expectations are obsolete: line 85 pins `openDesktopLocalTarget(local.path)`; line 94 expects bare absolute guest targets to bypass provenance. Both failures were reported to the independent test member; implementation does not restore the unsafe behavior to make fixtures green.
3. `node --check electron/main.cjs` and scoped `git diff --check`: exit 0.

The fixture's Host live-agent registry, shell application launch, Menu and context DOM are explicit doubles; HTTP routing, runtime source resolution, containment and materialized files are real. It does not claim the user's current GUI is updated or prove OS application launch/native menu timing. Listener and temporary workspace tree were cleaned up; background test job was collected. Fixture location was sent to the root/test owner for independent persisted regression coverage.

## Acceptance boundary

Root should review this main integration before accepting the preview member's end-to-end task. The independent test owner must reconcile old expectations and supply final durable behavior evidence. GUI deployment/refresh and release gates remain separate. No passing independent release verdict is asserted by this author report.
