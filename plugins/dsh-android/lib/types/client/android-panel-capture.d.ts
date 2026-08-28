/**
 * The panel toolbar's 截图 (Screenshot) flow: POST `/_dsh/dsh-android/capture`
 * (the host captures a FRESH PNG of the current streamed device and signs a
 * relative screenshot URL), then `window.open(screenshotUrl, '_blank')` and a
 * transient "已截图 / Captured" inline confirmation in the toolbar that
 * auto-hides after ~2 s.
 *
 * The state machine lives in `createAndroidCaptureController` — a pure,
 * timer-injectable controller the dev-panel-smoke script drives with fake
 * timers and a mocked fetcher (no browser, no device). `useAndroidCapture`
 * binds it to React for the panel; it performs no network during render
 * (capture only ever runs from a click).
 */
import { type AndroidFetcher } from './protocol.js';
export type AndroidCapturePhase = 'idle' | 'busy' | 'done';
/** How long the "captured" confirmation stays visible (~2 s). */
export declare const ANDROID_CAPTURE_CONFIRM_MS = 2000;
/** Injectable timers (the smoke drives the auto-hide with a fake clock). */
export interface AndroidCaptureTimers {
    setTimeout: (fn: () => void, ms: number) => unknown;
    clearTimeout: (handle: unknown) => void;
}
export interface AndroidCaptureControllerOptions {
    /** Fetcher to POST the capture endpoint with (defaults to global fetch). */
    fetcher?: AndroidFetcher;
    sessionId?: string;
    /** Opens the minted screenshot URL; defaults to `window.open` in a browser. */
    openWindow?: (url: string, target: string) => void;
    /** Auto-hide delay for the confirmation (default `ANDROID_CAPTURE_CONFIRM_MS`). */
    autoHideMs?: number;
    /** Injectable timers (fake-clock tests). */
    timers?: AndroidCaptureTimers;
}
export interface AndroidCaptureController {
    getPhase: () => AndroidCapturePhase;
    /** POST the capture route and open the minted URL. Resolves true on
     * success; false on a failed request (phase returns to idle). */
    capture: (device?: string) => Promise<boolean>;
    subscribe: (listener: () => void) => () => void;
    dispose: () => void;
}
/**
 * The pure capture state machine, bound to an options ref so the React hook
 * can pass fresh fetcher/openWindow values without recreating the store.
 */
export declare function createAndroidCaptureController(optionsRef: {
    current: AndroidCaptureControllerOptions;
}): AndroidCaptureController;
export interface AndroidCaptureSession {
    phase: AndroidCapturePhase;
    /** Kick off a fresh capture for `device` (toolbar click handler). */
    capture: (device?: string) => void;
}
/** React binding: capture on click → open minted URL + transient toast. */
export declare function useAndroidCapture(options: AndroidCaptureControllerOptions): AndroidCaptureSession;
