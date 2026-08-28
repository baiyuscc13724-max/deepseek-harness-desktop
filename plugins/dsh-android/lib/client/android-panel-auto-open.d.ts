/**
 * Auto-open for the device panel when a device is explicitly STARTED.
 *
 * The panel is normally opened by a user gesture (a row click, the input-dock
 * capsule, a device pick). When the AGENT runs the explicit start verb —
 * `android_boot` — the user asked for a device to come up, so the panel
 * should open by itself the moment the settled result lands, exactly like
 * dsh-openpencil auto-opens its editor after `openpencil_render`.
 *
 * This module is PURE (no React, no DOM, no network) so the dev-panel-smoke
 * script can drive the decision and the one-shot registry directly. The
 * guards mirror openpencil's `liveAutoOpen*` helpers and all three matter:
 *
 * - settled-and-not-error: the caller short-circuits on `running`/`error`
 *   BEFORE consulting the decision, so a still-running call never opens and
 *   a failed start never opens;
 * - one-shot: `takeAndroidPanelAutoOpenCall` consumes the key exactly once,
 *   so a re-render of the settled card never reopens the panel, and a user
 *   CLOSE is never fought (that call already consumed its open);
 * - activation timestamp: only blocks whose own `block.time` is at least the
 *   activation time count, so scrolling back through an old session replays
 *   the cards WITHOUT re-opening the panel.
 */
/** The ONE start verb that auto-opens the panel; nothing else does. */
export declare const ANDROID_PANEL_AUTO_OPEN_TOOLS: readonly string[];
/**
 * Client activation timestamp. The bundle module is evaluated once per page
 * load, so a call only auto-opens when its block is NEWER than this — a
 * history replay (which re-mounts old cards with old `block.time`) stays
 * silent.
 */
export declare const androidPanelAutoOpenActivatedAt: number;
/** The one-shot registry key: session + call identity, like openpencil. */
export declare function androidPanelAutoOpenKey(sessionId: string, callId: string): string;
/** Arm the key while the call runs, so its settle can take it exactly once. */
export declare function rememberAndroidPanelAutoOpenCall(key: string): void;
/** Consume the key exactly once; false after the first take (or when absent). */
export declare function takeAndroidPanelAutoOpenCall(key: string): boolean;
/** Forget the key after an error so a later successful result may take it. */
export declare function forgetAndroidPanelAutoOpenCall(key: string): void;
/** Inputs to the pure decision (all caller-supplied; no clock reads inside). */
export interface AndroidPanelAutoOpenDecision {
    toolName: string;
    isError: boolean;
    /** The result's own timestamp (`ToolCallBlock.time`), not now(). */
    blockTime: number;
    /** The call's session (the card's framework-supplied `sessionId`). */
    sessionId: string;
    /** The module-load activation timestamp (see above). */
    activatedAt: number;
    /** The CURRENT session, supplied separately so a stale result is rejected. */
    currentSessionId: string;
}
/**
 * Pure auto-open decision: true only for a settled, non-error START verb in
 * the CURRENT session whose block is at least as new as activation. Every
 * guard is explicit so the smoke can assert each one independently.
 */
export declare function androidPanelAutoOpenShouldOpen(input: AndroidPanelAutoOpenDecision): boolean;
