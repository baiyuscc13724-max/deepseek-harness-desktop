/**
 * The one live-stream/control engine behind the dsh-android panel.
 *
 * A hybrid of the two dsh-ios sessions, because Android needs exactly half of
 * each: the GRANT lifecycle of the simulator stream session (generation
 * numbering, one-shot auto re-grant, seeded grant + settle watchdog) with the
 * REST control plane of the real-device session (coalesced pointer gestures
 * POSTed to `/control`). There is NO WebSocket anywhere in this plugin.
 *
 * - `POST /grant {kind:'stream', device}` → `<img src={streamUrl}>`, the
 *   in-process `multipart/x-mixed-replace` PNG stream. No `wsUrl` exists.
 * - LIVENESS is the FRAME itself: the img's `load` event with
 *   `naturalWidth > 0` is the only "the stream is up" signal there is (the
 *   ws `open` event dsh-ios used has no counterpart). `onFrameLoad` is
 *   therefore part of the session contract and the live-frame body calls it.
 * - Pointer gestures are coalesced (see `androidGestureActionOf`): one tap or
 *   one drag per gesture, POSTed to `/control` on pointer-up. Move events are
 *   sampled on a ~50 ms trailing edge for the gesture bookkeeping only.
 * - Buttons (◁ ○ □ and the hardware keys) and rotate are single POSTs too.
 *
 * Failure policy: an initial grant failure falls back with a retry; a stream
 * that dies after a successful grant (img error — e.g. the ~10-minute token
 * expiry) re-grants once automatically before falling back. Refresh re-grants,
 * which restarts an idle device's frame loop server-side per `/grant`.
 * Unmount drops the img src and reports offline.
 *
 * Device switch: a `seededGrant` (the switch-device response's fresh
 * capability URL) is applied exactly once, on the grant cycle whose serial
 * matches the seed, so the swap lands without a second round trip. Every
 * later re-grant goes through `/grant` normally.
 */
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { type AndroidFetcher, type AndroidStreamMeta } from './protocol.js';
export type AndroidStreamPhase = 'granting' | 'live' | 'fallback';
/**
 * Post-switch settle watchdog tuning: after a device switch seeds the stream,
 * re-grant every 4 s while no frame has drawn, up to 10 attempts (~40 s —
 * covers an emulator that is still coming up), then fall back with the retry
 * affordance. Exported for the smoke's assertions.
 */
export declare const ANDROID_SWITCH_SETTLE_INTERVAL_MS = 4000;
export declare const ANDROID_SWITCH_SETTLE_ATTEMPTS = 10;
/**
 * A pre-minted capability the stream session may adopt instead of POSTing
 * `/grant`: the device-switch flow hands over the switch-device response's
 * fresh URL so the new stream lands without a second round trip. Applied
 * exactly once (the next grant cycle whose serial matches); later re-grants
 * (refresh, img death, token expiry) go through `/grant` normally.
 */
export interface AndroidSeededGrant {
    serial: string;
    streamUrl: string;
    expiresAt?: number;
}
export interface AndroidStreamSessionOptions {
    /** Stream presentationMeta (absent only for a disabled session). */
    meta?: AndroidStreamMeta;
    fetcher?: AndroidFetcher;
    /** Trusted Harness session scope carried by the panel host. */
    sessionId?: string;
    /** Static fallback message shown once the auto-retry budget is spent. */
    unavailableCopy: string;
    /** Observes the live/offline transitions (the panel's ● Live dot). */
    onLiveChange?: (live: boolean) => void;
    /** When false the grant effect never runs (the panel owns one session per
     * render but only activates it for stream-mode results). Default true. */
    enabled?: boolean;
    /** One-shot pre-minted capability (device switch). */
    seededGrant?: AndroidSeededGrant;
    /** Locale table (androidCopy) used to localize route failure codes. */
    copy?: Record<string, string>;
}
export interface AndroidStreamSession {
    phase: AndroidStreamPhase;
    streamUrl: string | undefined;
    failure: string;
    /** True once a frame has drawn (the panel's "● 实时" source). */
    live: boolean;
    imgRef: RefObject<HTMLImageElement>;
    /** The device's last known `user_rotation` (0..3), when a rotate reported one. */
    rotation: number | undefined;
    /** Manual refresh: clear the auto-retry budget and re-grant. */
    refresh: () => void;
    /** One automatic re-grant (img error), then the fallback. */
    retryOnce: () => void;
    /**
     * The stream img reported a decoded frame. `naturalWidth > 0` is the only
     * liveness signal this transport has, so the frame surface MUST call it.
     */
    onFrameLoad: (naturalWidth: number, naturalHeight: number) => void;
    /** One navigation/hardware button (`back` / `home` / `recents` / …). */
    sendButton: (name: string) => void;
    /** Advance the display rotation cycle; the response reports the new value. */
    sendRotate: () => void;
    /** Pointer handlers over the stream surface; coordinates are normalized
     * against the element's displayed bounds and sent as-is (the frame follows
     * the display rotation, so there is nothing to inverse-map). */
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
}
/**
 * The one live-stream engine the panel binds. Every field is derived state —
 * no rendering lives here, so any surface can frame it however it likes.
 */
export declare function useAndroidStream(options: AndroidStreamSessionOptions): AndroidStreamSession;
