# Mobile sync WebSocket baseline lifecycle

## Scope and observed failure

This is the local `MobileSyncService.#fetchWorkspaceBaseline` client of the official runtime `/api/remote.mux` stream, not a phone transport, pairing/authentication change, or a global Electron error handler.

The supplied main-process screenshot reports `WebSocket was closed before the connection was established`, with `ws.close → finish → AbortSignal.aborted → refresh timeout`. The maintained source matched that path: `finish` removed every socket listener and then called `socket.close()`. In installed **ws 8.21.3**, closing a CONNECTING socket calls `abortHandshake`, which later emits `error` before `close`. With no listener, Node throws an unhandled EventEmitter error. Catching the synchronous `close()` call alone does not catch this later event.

A real loopback HTTP server held its upgrade handshake while returning a valid `session/list` response. Calling the public `refreshWorkspaceManifest()` with the original 8-second timeout reproduced the exact stack and **process exit 1**, without an `uncaughtException` handler. This confirms a lifecycle bug; it does not diagnose the user's network or imply a broken phone.

## Lifecycle contract

1. **Pending:** Install named `open`, `message`, `error`, `close` handlers and an abort listener before checking `signal.aborted`. `open/send` synchronous and callback errors are ordinary failures. Ignore another stream ID; reject malformed or premature-ending baseline frames.
2. **Settle once:** `settled` is set before cleanup. The first failure or valid baseline determines the Promise outcome. Subsequent events cannot change it or commit another manifest.
3. **Retain socket-local error ownership:** Before removing business handlers, attach one terminal `error` guard to this exact socket. It intentionally remains for the socket's lifetime, including after `close`, so delayed teardown errors are handled. It captures no service/Promise state. This is not a process/global exception handler and is installed only once, after the primary outcome has been captured.
4. **Remove only owned handlers:** Remove the named baseline handlers with `removeListener`; do not call `removeAllListeners`. Injected runtime transport listeners must survive. Remove the abort listener immediately.
5. **State-aware bounded teardown:** CONNECTING uses `terminate()` when available, still with error ownership because it too can emit asynchronous error. OPEN/CLOSING uses `close()` with a one-second unref'ed fallback to `terminate()`. A terminal close clears that timer and its cleanup listener. Already-CLOSED needs no close or timer. A synchronous close failure rejects a previously successful baseline rather than reporting a false commit; preserve an existing primary error.
6. **Cancel siblings:** Public refresh still uses the existing 8-second timeout. In `finally`, clear that timer and abort the shared controller. If `session/list` failed first, this disposes the pending WebSocket rather than clearing its only timeout and abandoning a CONNECTING socket.
7. **Outcomes:** Failures retain `refreshState:'unavailable', complete:false, applied:false, protected:true` and do not replace durable data. A valid baseline plus session index can commit once and return authoritative/protected as before. No reconnect/retry loop is introduced, and no caller scheduling/backoff policy is changed.

The remaining terminal error guard is deliberate. After close there are zero baseline open/message/error/close handlers and zero abort listeners, plus this one socket-local error guard; injected transport listeners are not counted as baseline handlers and are not removed. The guard does not keep a socket in a service collection. No “all listener counts must be zero” test should recreate the original unhandled-error bug.

## Real-ws controlled test method

Use a separate Node process and the maintained `ws` package; bind a self-owned HTTP server to `127.0.0.1:0`. Do not use the actual runtime, real phone, private network service, pairing store, credentials, or installed application. Stub only the persistence DTO (`readSyncChanges` and a counted `commitSyncManifest`); use a real HTTP POST response with the incoming `rpcId` and a real `WebSocketServer({noServer:true})` for successful upgrades.

Drive the public `refreshWorkspaceManifest`, not a copied implementation. A `WebSocketImpl` subclass may retain the real client for post-result assertions. No client-side test error listener may mask the regression before production installs its guard. Server-side peers may own their own expected error events.

| Scenario | Control | Required outcome |
|---|---|---|
| Timeout while CONNECTING | Hold HTTP upgrade, serve valid session index; use actual 8s timeout | unavailable, no commit, CLOSED, process alive |
| Session index failure while CONNECTING | Hold upgrade; return HTTP 503 only after upgrade observed | immediate bounded cancellation, no orphan socket, unavailable |
| Handshake rejection | HTTP 403 instead of upgrade | unavailable; failure remains owned |
| Normal baseline | Read open frame/streamId, return valid empty baseline + session list | one commit; authoritative |
| Invalid baseline frame | Send invalid JSON | unavailable, zero commits |
| Close before baseline | Peer sends close first | unavailable, zero commits |
| Error/close/abort race | Inject client error, then terminate; refresh finally aborts shared signal | one outcome; zero commits |
| Uncooperative close | After valid baseline, pause peer TCP reads | one-second terminate fallback; one commit; CLOSED |
| Explicit/repeated abort | Test-only capture of refresh AbortController; abort once/twice at observed upgrade | unavailable, one close; repeated cancel harmless |
| Already aborted | Test-only first controller starts aborted | no missed cancellation; unavailable; one close |
| Send throw/callback error | Real client subclass injects each failure at send boundary | unavailable, zero commits |
| Close throws | Real client subclass throws at close boundary | rejected success; terminate fallback; no commit |
| Late events | After completion and close, emit error/message/close on retained client | process alive; no new commit; foreign message handler retained |

Explicit cancellation controller instrumentation and send/close fault injection are test seams, not claims that these faults happened on the user's network. Restore all instrumentation in `finally`.

For the eight network/terminal cases, record timers scheduled at 8000ms and 1000ms, remove them from the test registry on fire/clear, and assert none remain after `close`. Use `getEventListeners(signal,'abort')` to ensure the named baseline `aborted` callback is gone. Assert the production error guard count is one and normal baseline handlers are absent. Include one unrelated client message listener to prove targeted cleanup preserves it.

Use bounded event waits, not sleeps/polling. Close peer sockets, terminate WebSocketServer peers, close both servers in `finally`; no real phone config or global exception handler is needed. Official regression tests belong to the team's Test member; these implementation fixtures were transient Node invocations and did not modify test files.

## Validation snapshot and limits

2026-09-05 implementation verification:

- Pre-fix: exact 8-second CONNECTING failure reproduced, expected exit 1.
- Post-fix: 8 real-ws network/terminal scenarios + 6 explicit abort/operation-fault scenarios passed, each with bounded self-owned loopback resources.
- `node --test tests/mobile-sync-service.test.cjs tests/mobile-sync-store.test.cjs`: **56/56 pass**, exit 0. Existing `util._extend` deprecation warning is not a failure and was not addressed here.
- Syntax and scoped whitespace checks passed.
- Source SHA-256 before lifecycle edit (already contained the separate 1.0.60 version update): `58193eee8a84a0b2128c7bb341a1357abb06d84a8f4573c67c20b0ffc89c4176`.
- Source SHA-256 after lifecycle edit: `c16554c91543c50d547b57315e14a1a389d985599104d80ab146d35e3a750c72`.

No installed application files or real configuration were changed; no GUI/phone end-to-end or installed build was exercised. The screenshot proves the observed stack, not that all networking problems are fixed. Final independent regression and release gates remain separate.
