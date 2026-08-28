/**
 * Browser-side wire contract for the dsh-android device cards and panel.
 *
 * Pure helpers only — nothing touches the DOM at module scope, and every
 * function exported here is safe to call from Node, so the dev-panel-smoke
 * script drives the exact bytes the panel sends in a browser.
 *
 * Contract summary (host side, see src/stream-routes.ts):
 * - `output.presentationMeta` rides into `ToolResultNode.meta` verbatim with
 *   kinds `android-stream` | `android-screenshot` | `android-build-run`.
 * - `POST /_dsh/dsh-android/grant` re-mints origin-relative capability URLs
 *   at render time; tokens expire within 10 minutes. `{kind:'stream'}` →
 *   `{streamUrl, expiresAt, device}` — there is **no wsUrl**: this plugin has
 *   NO WebSocket at all. `{kind:'screenshot', path}` → `{screenshotUrl,
 *   expiresAt}`.
 * - `POST /_dsh/dsh-android/switch-device {device}` → the grant shape plus
 *   `{device, deviceName}`; only ONLINE serials are accepted (an AVD boot
 *   takes minutes and belongs to the `android_boot` tool).
 * - `POST /_dsh/dsh-android/devices {}` → `{devices:[{serial,state,kind,
 *   model?,streaming?}], avds:[string]}` — ONE array (emulators and phones
 *   stream through the same code path), plus the machine's AVD names.
 * - `POST /_dsh/dsh-android/capture {device?}` → `{screenshotUrl, path,
 *   bytes, expiresAt}`.
 * - `POST /_dsh/dsh-android/status {device?}` → `{running, serial?,
 *   deviceName?}`.
 * - `POST /_dsh/dsh-android/control {device, action}` — the ONE control
 *   channel: tap / drag (NORMALIZED 0..1 of the streamed frame) / button /
 *   type / rotate. A rotate answers `{rotation: 0..3}`.
 * - `POST /_dsh/dsh-android/device-action {device?, action}` → `{action}`.
 * - Every failure is `{ok:false, code, error}`; the UI localizes off the
 *   CODE and keeps the host's English `error` as the fallback.
 *
 * COORDINATE SPACE: an Android `screencap` frame follows the DISPLAY
 * rotation (a landscape app streams 2400×1080) and `input tap` addresses the
 * same space, so normalized pointer coordinates over the displayed box go
 * STRAIGHT to `/control` — there is no framebuffer/display mismatch and no
 * inverse rotation anywhere in this client.
 * @module @zseven-w/dsh-android/client/protocol
 */
/** Wire tool names the client registers conversation cards for. */
export declare const ANDROID_CARD_TOOLS: {
    readonly boot: "android_boot";
    readonly screenshot: "android_screenshot";
    readonly interact: "android_interact";
    readonly buildRun: "android_build_run";
};
/** HTTP prefix owned by the dsh-android web routes. */
export declare const PLUGIN_ROUTE_PREFIX = "/_dsh/dsh-android";
/** The grant endpoint the cards/panel POST to at render time. */
export declare const GRANT_ROUTE_PATH = "/_dsh/dsh-android/grant";
/** The read-only stream-status endpoint the input-dock capsule polls. */
export declare const STATUS_ROUTE_PATH = "/_dsh/dsh-android/status";
/** The fresh-screenshot endpoint the panel toolbar's 截图 button POSTs to. */
export declare const CAPTURE_ROUTE_PATH = "/_dsh/dsh-android/capture";
/** The device-switch endpoint the panel header's device picker POSTs to. */
export declare const SWITCH_DEVICE_ROUTE_PATH = "/_dsh/dsh-android/switch-device";
/** The pickable-device listing endpoint the picker refreshes on open. */
export declare const DEVICES_ROUTE_PATH = "/_dsh/dsh-android/devices";
/** The single control endpoint (tap/drag/button/type/rotate). */
export declare const CONTROL_ROUTE_PATH = "/_dsh/dsh-android/control";
/** The device-level action endpoint (notification shade, lock, …). */
export declare const DEVICE_ACTION_ROUTE_PATH = "/_dsh/dsh-android/device-action";
/** The device summary embedded in every presentationMeta envelope. */
export interface AndroidDeviceInfo {
    serial?: string;
    name?: string;
    androidVersion?: string;
    state?: string;
}
/** One device from the host `/devices` listing (adb shape, ONE array). */
export interface AndroidDeviceEntry {
    serial: string;
    /** adb's device state: `device` (online), `offline`, `unauthorized`, … */
    state: string;
    kind: 'emulator' | 'physical';
    model?: string;
    /** True for the device the host is currently streaming. */
    streaming?: boolean;
}
/** The listing: the devices plus the machine's AVD names (context only). */
export interface AndroidDeviceListing {
    devices: AndroidDeviceEntry[];
    /** AVD names the picker shows as an unclickable "start it with
     * android_boot" hint — booting an emulator takes minutes and is not tied
     * to a serial until it appears, so it is never a click in the panel. */
    avds: string[];
}
/** Only a fully online device can stream or take control ops. */
export declare function androidDeviceOnline(device: AndroidDeviceEntry): boolean;
export interface AndroidStreamMeta {
    kind: 'android-stream';
    device: AndroidDeviceInfo;
    streamRouteId?: string;
}
export interface AndroidScreenshotMeta {
    kind: 'android-screenshot';
    /** Primary path (also exposed as `screenshotPath` by the host). */
    path: string;
    screenshotPath?: string;
    device: AndroidDeviceInfo;
}
export interface AndroidBuildRunMeta {
    kind: 'android-build-run';
    device: AndroidDeviceInfo;
    packageName?: string;
    apkPath?: string;
}
export type AndroidMeta = AndroidStreamMeta | AndroidScreenshotMeta | AndroidBuildRunMeta;
/**
 * Defensively parse the presentationMeta the host projected into
 * `ToolResultNode.meta`. Unknown or malformed shapes return `undefined` and
 * the card falls back to its plain fallback UI — never a throw.
 */
export declare function parseAndroidMeta(meta: unknown): AndroidMeta | undefined;
/** Fetch surface the cards use; injectable for tests and headless hosts. */
export type AndroidFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export interface StreamGrantResponse {
    streamUrl: string;
    expiresAt?: number;
    device?: string;
}
export interface ScreenshotGrantResponse {
    screenshotUrl: string;
    expiresAt?: number;
}
export type GrantFailure = {
    ok: false;
    status?: number;
    error: string;
    code?: AndroidRouteErrorCode;
};
/**
 * Stable failure reasons the routes report alongside their English `error`
 * detail (mirrors `AndroidRouteErrorCode` in src/stream-routes.ts). The host
 * cannot know which language the browser shows, so the UI localizes off the
 * CODE and keeps the English text as the fallback for anything unrecognized.
 */
export type AndroidRouteErrorCode = 'forbidden' | 'bad_method' | 'bad_content_type' | 'bad_request' | 'device_unknown' | 'device_offline' | 'device_unauthorized' | 'device_busy' | 'stream_not_running' | 'stream_failed' | 'token_invalid' | 'screenshot_missing' | 'adb_unavailable' | 'unavailable';
/**
 * Localized text for a route failure: the code wins, the host's English
 * detail is the fallback. `copy` is the locale table (androidCopy(locale)) —
 * passed in rather than imported so this module stays copy-agnostic.
 */
export declare function androidRouteErrorTextOf(failure: {
    error: string;
    code?: string;
}, copy: Record<string, string>): string;
/**
 * The exact grant request body the stream surface sends. With a serial the
 * route starts (or reuses) the stream for that device; without one it falls
 * back to the device the session is already streaming.
 */
export declare function streamGrantBodyOf(input: {
    device?: {
        serial?: string;
    };
    sessionId?: string;
}): {
    kind: 'stream';
    device?: string;
    sessionId?: string;
};
/** POST the grant endpoint and read back the minted capability URL. */
export declare function requestStreamGrant(fetcher: AndroidFetcher, input: {
    device?: {
        serial?: string;
    };
    sessionId?: string;
}): Promise<{
    ok: true;
    grant: StreamGrantResponse;
} | GrantFailure>;
/** The exact grant request body the screenshot surface sends. */
export declare function screenshotGrantBodyOf(path: string): {
    kind: 'screenshot';
    path: string;
};
/** POST the grant endpoint for one screenshot path in the plugin cache. */
export declare function requestScreenshotGrant(fetcher: AndroidFetcher, path: string): Promise<{
    ok: true;
    grant: ScreenshotGrantResponse;
} | GrantFailure>;
/**
 * Host-side read-only stream status the input-dock capsule polls while the
 * panel is closed (POST `/status`). The host names the device `serial`.
 */
export interface AndroidStreamStatus {
    running: boolean;
    serial?: string;
    deviceName?: string;
}
/**
 * POST the read-only status endpoint and defensively parse the snapshot.
 * The endpoint never starts a stream and never mints capability tokens.
 */
export declare function requestAndroidStatus(fetcher: AndroidFetcher, input?: {
    device?: string;
    sessionId?: string;
}): Promise<AndroidStreamStatus>;
/** A fresh capture minted by the host route. */
export interface AndroidCaptureResponse {
    screenshotUrl: string;
    path: string;
    bytes: number;
    expiresAt?: number;
}
/** The exact capture request body the toolbar sends (device optional). */
export declare function captureBodyOf(input: {
    device?: string;
    sessionId?: string;
}): {
    device?: string;
    sessionId?: string;
};
/**
 * POST the capture endpoint and read back a freshly minted screenshot URL.
 * The route captures a NEW PNG of the current streamed (or explicitly named,
 * online) device — no prior presentationMeta path is involved.
 */
export declare function requestAndroidCapture(fetcher: AndroidFetcher, input?: {
    device?: string;
    sessionId?: string;
}): Promise<{
    ok: true;
    capture: AndroidCaptureResponse;
} | GrantFailure>;
/** Fresh capability minted by the switch-device route (grant + identity). */
export interface AndroidSwitchResponse {
    streamUrl: string;
    expiresAt?: number;
    device: string;
    deviceName?: string;
}
/** The exact switch-device request body the panel picker sends. */
export declare function switchDeviceBodyOf(serial: string, sessionId?: string): {
    device: string;
    sessionId?: string;
};
/**
 * POST the switch-device endpoint: the explicit user gesture that takes over
 * the stream slot for another ONLINE device and mints fresh relative
 * capability URLs for it. An offline/unauthorized target answers a coded 409
 * (this route never boots an AVD — that is `android_boot`).
 */
export declare function requestSwitchDevice(fetcher: AndroidFetcher, serial: string, sessionId?: string): Promise<{
    ok: true;
    switched: AndroidSwitchResponse;
} | GrantFailure>;
/**
 * POST the pickable-device listing endpoint and defensively parse the ONE
 * `devices` array plus the `avds` names. Always resolves (empty on failure) —
 * the picker degrades to the current device and retries on the next open.
 * Host-side ordering (online first, then serial) is preserved as-is.
 */
export declare function requestAndroidDevices(fetcher: AndroidFetcher, sessionId?: string): Promise<AndroidDeviceListing>;
/**
 * One control action. tap/drag coordinates are NORMALIZED 0..1 of the
 * streamed frame; the host multiplies them by the CURRENT frame size, which
 * follows the display rotation, so the panel never converts anything.
 */
export type AndroidControlAction = {
    kind: 'tap';
    x: number;
    y: number;
} | {
    kind: 'drag';
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    durationMs?: number;
} | {
    kind: 'button';
    name: string;
} | {
    kind: 'type';
    text: string;
} | {
    kind: 'rotate';
};
/** Hardware/navigation buttons `/control` accepts (host: ANDROID_BUTTONS). */
export declare const ANDROID_BUTTONS: readonly ["home", "back", "recents", "power", "volume_up", "volume_down", "menu", "enter", "delete"];
export type AndroidButtonName = typeof ANDROID_BUTTONS[number];
/** The exact control request body the panel sends. */
export declare function controlBodyOf(device: string, action: AndroidControlAction, sessionId?: string): {
    device: string;
    action: AndroidControlAction;
    sessionId?: string;
};
export interface AndroidControlResult {
    /** The new `user_rotation` value (0..3) after a rotate action. */
    rotation?: number;
}
/**
 * POST the control endpoint. Fails fast with the route's coded error; the
 * panel treats control failures as non-fatal (a refused tap stays silent).
 */
export declare function postAndroidControl(fetcher: AndroidFetcher, device: string, action: AndroidControlAction, sessionId?: string): Promise<{
    ok: true;
    result: AndroidControlResult;
} | GrantFailure>;
/** The device-level actions the host exposes (host: ANDROID_DEVICE_ACTIONS). */
export declare const ANDROID_DEVICE_ACTIONS: readonly ["notifications", "quick-settings", "lock", "wake", "assistant"];
export type AndroidDeviceActionName = typeof ANDROID_DEVICE_ACTIONS[number];
/**
 * Run one device-level action. A coded failure comes back through the shared
 * failure shape and the menu keeps itself open for a retry.
 */
export declare function postDeviceAction(fetcher: AndroidFetcher, device: string | undefined, action: string, sessionId?: string): Promise<{
    ok: true;
    action: string;
} | GrantFailure>;
/**
 * `/control` exposes COMPLETE gestures only (`input tap`, `input swipe`) —
 * there is no touch begin/move/end streaming channel — so the panel
 * COALESCES each pointer gesture into ONE action on pointer-up: a still
 * click → `tap`; a moved pointer → one `drag` from the pointer-down anchor
 * to the FINAL release point with the gesture's own duration (clamped), which
 * `input swipe` animates linearly from→to. That reproduces a faithful slow
 * drag or a quick flick without a chain of separate down-up swipes.
 */
/** Movement below this fraction of the frame still counts as a tap. */
export declare const ANDROID_TAP_SLOP = 0.02;
/** Minimum/maximum drag duration sent to the host (seconds). */
export declare const ANDROID_DRAG_DURATION_MIN_S = 0.05;
export declare const ANDROID_DRAG_DURATION_MAX_S = 2;
/** Trailing-edge sampling cadence for drag move bookkeeping (ms). */
export declare const ANDROID_DRAG_MOVE_SAMPLE_MS = 50;
export interface AndroidPoint {
    x: number;
    y: number;
}
/**
 * One gesture → one control action: tap when the pointer barely moved,
 * otherwise a single drag from anchor to release point over the (clamped)
 * gesture duration.
 */
export declare function androidGestureActionOf(start: AndroidPoint, end: AndroidPoint, durationMs: number): AndroidControlAction;
/** Map a pointer event on an element to normalized 0..1 stream coordinates. */
export declare function normalizePointerPoint(event: {
    clientX: number;
    clientY: number;
}, bounds: {
    left: number;
    top: number;
    width: number;
    height: number;
}): AndroidPoint;
