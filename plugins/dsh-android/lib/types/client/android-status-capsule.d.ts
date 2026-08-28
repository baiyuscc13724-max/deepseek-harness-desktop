/**
 * Stream-status capsule for the composer input dock
 * (`conversation.input.dock`, the same seat openpencil's selection chip uses).
 *
 * While the device panel is CLOSED and a device stream is online, the capsule
 * renders a small pill above the message input box: green dot + device name +
 * "实时". (A gray idle variant is deliberately NOT rendered — the capsule only
 * appears while a stream is actually running.) Clicking the pill opens the
 * sidebar panel for the streamed device via the SAME panel store the panel
 * host uses; the panel's existing grant flow does the rest.
 *
 * SESSION GATE: the dock seat is session-scoped, so the framework hands this
 * component the current `sessionId`. The capsule renders AND polls only while
 * that session has at least one registered panel source (a settled Android
 * result whose card is mounted in THIS session). A brand-new empty session has
 * no sources, so the pill never shows there even though the global stream
 * keeps running; the status poll likewise never starts. Sources unregister on
 * card unmount, so switching to an unrelated session hides the capsule and
 * stops the poll.
 *
 * Stream knowledge comes from the read-only host route
 * `POST /_dsh/dsh-android/status` (`{running, serial?, deviceName?}`), polled
 * every ~5 s while gated on and the panel is closed. Polling stops while the
 * panel is open, refreshes immediately (debounced) when a tool result lands in
 * the panel-source registry, and fully cleans up on unmount. The poll loop
 * lives in `createAndroidStatusPoller` — a timer-injectable controller the
 * static smoke drives with a fake clock to prove the fetcher is never called
 * while the session has no sources.
 */
import { type AndroidLocale } from './copy.js';
import { type AndroidStreamStatus } from './protocol.js';
import { type AndroidPanelRequest, type AndroidPanelStore } from './android-panel-host.js';
/** Capsule polling cadence while the panel is closed. */
export declare const ANDROID_STATUS_POLL_MS = 5000;
/** Debounce for the panel-source-registry refresh (registration bursts). */
export declare const ANDROID_STATUS_REFRESH_DEBOUNCE_MS = 150;
export type AndroidStatusFetcher = (sessionId?: string) => Promise<AndroidStreamStatus>;
/** The browser default: POST the read-only host status route. */
export declare function fetchAndroidStreamStatus(sessionId?: string): Promise<AndroidStreamStatus>;
/**
 * Build the synthetic `android-stream` panel request for a streamed device: a
 * settled `android_boot`-shaped block whose presentationMeta carries the
 * device, so the panel's stream mode + grant flow take over from there. The
 * request is tagged with the session the capsule was clicked in.
 */
export declare function androidStreamStatusRequestOf(status: AndroidStreamStatus, sessionId?: string): AndroidPanelRequest;
/** Timer surface the poller needs (defaults to the real global timers). */
export interface AndroidStatusPollTimers {
    setInterval: (fn: () => void, ms: number) => unknown;
    clearInterval: (handle: unknown) => void;
    setTimeout: (fn: () => void, ms: number) => unknown;
    clearTimeout: (handle: unknown) => void;
}
/**
 * The capsule's poll loop as a small stateful controller: `setEnabled(true)`
 * starts an immediate poll + an interval; `setEnabled(false)` stops both and
 * drops any in-flight result; `refreshSoon()` schedules one debounced poll
 * (registry changes) and no-ops while disabled. Fully deterministic under an
 * injected timer for the static smoke — the fetcher is never called until the
 * capsule is actually gated on.
 */
export declare function createAndroidStatusPoller(options: {
    fetchStatus: AndroidStatusFetcher;
    pollIntervalMs: number;
    onStatus: (status: AndroidStreamStatus) => void;
    refreshDebounceMs?: number;
    timers?: AndroidStatusPollTimers;
}): {
    setEnabled: (enabled: boolean) => void;
    refreshSoon: () => void;
    dispose: () => void;
};
export interface AndroidStatusCapsuleBodyProps {
    status: AndroidStreamStatus | undefined;
    panelOpen: boolean;
    /** True while the current session has at least one registered panel source. */
    hasAndroidSources: boolean;
    locale: AndroidLocale;
    onOpen: () => void;
}
/**
 * Pure capsule presentation: null when the panel is open, the current session
 * has no Android sources, or the stream is not running; otherwise a green-dot
 * pill with the device name + 实时 that opens the panel on click. Exported for
 * static (SSR) smoke tests.
 */
export declare function AndroidStatusCapsuleBody({ status, panelOpen, hasAndroidSources, locale, onOpen, }: AndroidStatusCapsuleBodyProps): React.JSX.Element | null;
export interface AndroidStatusCapsuleProps {
    /** The panel store (defaults to the shared plugin instance). */
    store?: AndroidPanelStore;
    /** Status source (defaults to the read-only host status route). */
    fetchStatus?: AndroidStatusFetcher;
    pollIntervalMs?: number;
    locale: AndroidLocale;
    /** The current session id from the session-scoped dock seat. */
    sessionId?: string;
}
/**
 * Connected capsule: subscribes to the shared panel store (panel open/close)
 * and to the panel-source registry (session gate), polls the status fetcher
 * only while the panel is closed AND the current session has Android sources,
 * and opens the panel on click.
 */
export declare function AndroidStatusCapsule({ store, fetchStatus, pollIntervalMs, locale, sessionId, }: AndroidStatusCapsuleProps): React.JSX.Element | null;
