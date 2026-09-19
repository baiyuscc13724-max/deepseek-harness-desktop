# Browser / desktop control recovery contract

Implemented source contract for UI and independent regression review. No installed runtime has been replaced; native Electron/Windows acceptance remains separate from the isolated fixtures below.

## Proven desktop scope root cause

`plugins/dsh-desktop-computer-use/lib/desktop-control.js` emits a fixed `{scope:'desktop', action, payload}` after reading the Host capabilities state file. The bearer token and origin use the same authenticated loopback `/action` endpoint as `computer_use`. `electron/main.cjs:desktopModelToolAction` already has an explicit `desktop` branch dispatching to `WindowsDesktopUi` / DesktopDeviceProvider. But `browser-control-server.cjs:CONTROL_SCOPES` omits this implemented scope (only browser/computer/memory), rejecting the request before that branch. This is source-level client/server protocol drift, not evidence of incorrect user authorization or malformed model arguments. Installed-version drift is not yet verified.

Fix the missing **implemented** route with fixed desktop action validation; do not normalize arbitrary unknown scopes or alias desktop to computer (their parameters and target/ref semantics differ). Authentication, loopback boundary, generation fencing and shared authorization remain mandatory. `desktop_control status` must reach a read-only provider status; UI actions must still verify current authorization and invalidate old refs across target / shared control generation changes.

## Browser status contract (additive)

Keep existing `available`, `ready`, `visible`, `surface`, `tabAvailable`, `control`, `stopped`, `activationRequired`, `tabs`, and `dataPlane` fields. `ready` means an actionable HTTP(S) page, not authorization alone. Never infer readiness from sidebar visibility.

`recovery: { state, canBootstrap, actions, requiresUser, message }` is present in model `status`, UI `browserStatePayload.recovery`, and UI `browserStatePayload.session.recovery`:

| state | canBootstrap | actions | requiresUser |
| --- | --- | --- | --- |
| unavailable | false | [] | true |
| authorization-required | false | [] | true |
| stopped | false | [] | true |
| not-started | true | navigate, tabOpen | false |
| blank | true | navigate, tabOpen | false |
| tab-unavailable | false | tabList, tabSwitch | true |
| ready | false | observe | false |

Authorization/stopped/unavailable take precedence over no-tab state. Authorized never-started or empty/blank browser is not a closed/crashed tab. `status` is read-only and must not construct a tab or request authorization. `navigate` / `tabOpen` may create an isolated blank background session only after active shared control; loading the supplied HTTP(S) target still requires the existing strict URL/origin policy checks. Invalid URL can leave only that blank session, never a loaded denied target. Invalid URL/private network/credentials must remain denied. Crashed or explicitly unavailable tab is not automatically resurrected; status reports recovery requirements. `tabList` remains usable without an actionable page; `tabSwitch` may select an existing available tab, without gaining authorization.

## Stable action failures

- `browser-not-started` / `browser-blank-page`: no data plane yet; use status then allowed bootstrap action, not repeat observe.
- `tab-unavailable`: crashed/closed target; status then tabList/tabSwitch or user refresh. Do not automatically replay side effects.
- `browser-reference-stale` and existing Playwright binding-stale codes: re-observe; never replay an old ref.
- `browser-action-cancelled`: stopped/reset/aborted generation; re-check status, never blindly replay.
- `browser-outcome-unknown`: side effect may have executed; block mutations until existing trusted stop/resume recovery. Diagnostics remain permitted.
- Authorization and stopped codes retain their current fail-closed behavior.

Plugin descriptions and result guidance must distinguish bootstrap states from blocked states; they must not instruct a model to ask the user to create the very tab the authorized navigate tool can safely initialize. State from a newer Host takes precedence; legacy `surface:'not-started'` plus active control is also a supported cold-start diagnostic.

## Reference identity

Browser refs now have the opaque form `b<32-hex-observation-id>_<ordinal>`; callers must not parse or construct them. Host validation binds them to the latest observation, active tab/view, navigation generation, and model control ticket. Isolated world 1005 retains the original `Element` in a bounded 120-item Map; removed elements cannot be replaced by copying a DOM attribute. Re-observe, navigation, tab switch and Stop invalidate earlier identities. Playwright retains its separate world 1004 and existing binding contract.

Desktop UI refs retain their existing opaque format, but authorization and shared control generation are checked before inspect/perform and across awaited steps. A stale UIA result never falls back to old coordinates.

## Acceptance evidence

1. Exact desktop scope routes; arbitrary scope, wrong token and unsupported desktop action do not invoke handler.
2. Unauthenticated / disabled desktop UI read or input cannot execute; old refs fail after Stop/resume generation or target change.
3. Status cold start is read-only, reports bootstrap; active navigate/tabOpen passes unchanged URL policy; unauthorized/stopped does not bootstrap.
4. Blank, crashed, missing target, stale ref and unknown outcome are classified distinctly.
5. Browser sidebar hidden does not block structured actions; critical confirmation, password/payment prohibition and private-network gates remain enforced.
