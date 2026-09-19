# Browser main-process integration

## Bounded changed areas

Only browser helper/state/initialization/reference functions, `modelBrowserAction`, and `desktopModelToolAction` in `electron/main.cjs` changed. Added the existing URL-policy `checkModelNavigation` import. No Team, release, account, installation or user-configuration code changed.

- `browserRecoveryState()` is read-only. Status never creates a tab or pushes authorization. Reports unavailable, authorization-required, stopped, not-started, blank, tab-unavailable, ready with actionable recovery metadata.
- Both model status and UI `browserStatePayload` expose the same recovery object (UI also at `session.recovery`). HTTP page readiness and view visibility are separate. Empty titles/URLs clear stale values; tab snapshots do not call destroyed webContents getters.
- `requireBrowserForModel` checks active shared control and stopped policy before initialization. Read actions no longer create a blank view accidentally. Only explicit navigate/tabOpen may initialize a cold blank; crashed/invalid active tabs fail closed. Existing strict bootstrap/navigation URL policies remain responsible for loading the target.
- Cold tabOpen reuses the newly initialized blank instead of creating a second orphan blank. Its load wait is bounded and timeout reports outcome-unknown.
- tabList works without a current HTTP document and fixes the prior undefined `activeTabId` reference. tabSwitch validates an existing live destination through the existing model URL policy (stored private-origin grants, never blanket private-network allowance) before switching; source-page availability is no longer a prerequisite.
- Tab close selects the next tab through the standard switch helper, synchronizing title/loading/error; closing the last tab retains the established new-blank behavior rather than reporting it as a crashed page.
- Browser observe generates unique opaque refs per observation and retains original Element identities in isolated world 1005 (separate from Playwright 1004). Host checks latest observation, exact view/tab, navigation generation and model control ticket. Metadata/extract/DOM click/type/select use the isolated identity rather than reselecting a replacement node with a copied attribute. Observation, navigation, switch, and Stop invalidate prior refs. Missing targets produce browser-reference-stale instead of silent typed/clicked success.
- `desktopModelToolAction` does not synchronize the indicator on status and passes cancellation context to the structured UI route; aborted requests cannot enter it.

## Initial implementation member's executed evidence (historical; not rerun claims)

1. Final source syntax: `node --check` for main, WindowsDesktopUi, both modified plugins, plus earlier browser-control-server check — passed.
2. Final existing security suite: `node --test tests/browser-control-server.test.cjs tests/browser-security-policy.test.cjs tests/browser-url-policy.test.cjs tests/browser-action-gate.test.cjs tests/browser-codex-parity.test.cjs tests/browser-operation-coordinator.test.cjs` — **69 passed, 0 failed**.
3. Inline isolated Node VM using the actual main source functions, not copies: **21** assertions on authorization/stopped precedence, cold status read-only, no observe bootstrap, exactly one explicit blank initialization, blank/ready/crashed distinctions and old ref denial after navigation/control/observation changes; plus **6** WindowsDesktopUi assertions on auth/Stop/resume/racing observe — passed (27 total).
4. Actual observe/metadata scripts executed against a synthetic DOM in isolated world 1005: unique next-observation identity, old ref rejection, and removed Element replaced with a different Element carrying the copied attribute — passed. The initial fixture omitted `hasAttribute`; corrected the fixture and reran successfully; this was not a product exception.
5. Isolated real BrowserControlServer HTTP fixture: exact desktop status reached handler; unknown scope, unsupported desktop action, wrong bearer and old server endpoint/generation never reached handler — passed. Temporary fixture state was removed and listener stopped.

## Explicit remaining validation boundary

No running installation has been replaced or restarted. No native Windows desktop clicks or live Electron DOM experiment was performed; fake DOM/native provider fixtures do not prove all real renderer/UIA timing. The first wider 78-test run had 71 pass / 7 fail: six existing desktop mocks lack the now-required real-provider `assertAuthorized()` contract, and one source-regex UI test pins the obsolete surface expression. Independent test member owns updating those fixtures/behavioral assertions and adding persisted recovery/identity regressions. Tests were not edited by this implementation member. No deployment, commit or publication occurred.

Native UIA work already dispatched by its provider cannot be rolled back by a JavaScript cancellation check; late results are rechecked and no fallback input is sent after abort/generation change. Existing native provider process-cancellation capability remains outside this bounded main integration.

## Replacement-member upload rework verification — 2026-09-05

The lead rejected the initial upload binding: metadata checked the original isolated-world Element, but later CDP `getDocument/querySelector/describeNode` awaits could resolve a replacement file input with the copied attribute. Rechecking metadata before/after this chain would not establish the uploaded node's identity.

Fresh source inspection on replacement found the predecessor had already removed that chain. Preserved this bounded rework instead of rewriting it:

- `browserElementMetadata` now returns an `opaque-ref:<ref>` confirmation identity, never a selector-resolved backendNodeId.
- `modelBrowserAction(upload)` still requires a visible observed file input, shared control, exact ref, policy approval / one-use confirmation and an interactive picker. Binding carries the exact ref, origin, URL, tab and navigation generation.
- `uploadBrowserFileInteractively` retains file size/type/unchanged-handle checks and transfer lock. Its single synchronous isolated-world 1005 closure resolves the original Map Element, checks connected file-input identity/disabled state, creates the FileList and assigns it to that same object without any intervening await or selector fallback. Removing the original and copying its attribute cannot give the replacement the bytes.

New execution by the replacement member (not the earlier member's claims):

1. `node --test tests/browser-control-server.test.cjs tests/browser-security-policy.test.cjs tests/browser-url-policy.test.cjs tests/browser-action-gate.test.cjs tests/browser-codex-parity.test.cjs tests/browser-operation-coordinator.test.cjs`: **68/69 pass, exit 1**. Sole failure: parity line 60 requires `/DOM\\.resolveNode/`, which pins the removed vulnerable implementation. Reported to the independent test owner; not suppressed or made green by restoring the chain.
2. Temporary `control-upload-recovery-fixture.cjs`, executing the actual extracted main functions inside an isolated Electron **43.2.0 / Chromium 150.0.7871.129** hidden BrowserWindow, **9 cases pass, exit 0**: positive upload preserves chosen bytes and one original-target change event; same-attribute replacement inserted at the real picker await, file stat await, file read await, and immediately before the final isolated-world dispatch each returns stale with replacement files empty/no change event; Stop, picker cancel, confirmation-required (no picker), and new-observation old-ref denial also pass.
3. Fixture uses a private nonpersistent session and an intercepted fixture HTTPS URL, not any user page or replacement GUI server. Source functions `observeBrowserForModel`, metadata, ref/transfer assertions, interactive upload and `modelBrowserAction` are extracted directly, not copied implementations. Authorization, confirmation response and picker are deliberate test doubles; file reads and DOM FileList/Event behavior are real. The native picker UI, live GUI installation and native UIA remain untested here. Window and temporary chosen-file directory were closed/removed.

The temporary fixture has been handed to the test owner for persisted independent coverage. No test file, installed runtime, user configuration, Git commit or release was modified by this recovery verification.
