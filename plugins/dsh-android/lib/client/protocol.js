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
export const ANDROID_CARD_TOOLS = {
    boot: 'android_boot',
    screenshot: 'android_screenshot',
    interact: 'android_interact',
    buildRun: 'android_build_run',
};
/** HTTP prefix owned by the dsh-android web routes. */
export const PLUGIN_ROUTE_PREFIX = '/_dsh/dsh-android';
/** The grant endpoint the cards/panel POST to at render time. */
export const GRANT_ROUTE_PATH = `${PLUGIN_ROUTE_PREFIX}/grant`;
/** The read-only stream-status endpoint the input-dock capsule polls. */
export const STATUS_ROUTE_PATH = `${PLUGIN_ROUTE_PREFIX}/status`;
/** The fresh-screenshot endpoint the panel toolbar's 截图 button POSTs to. */
export const CAPTURE_ROUTE_PATH = `${PLUGIN_ROUTE_PREFIX}/capture`;
/** The device-switch endpoint the panel header's device picker POSTs to. */
export const SWITCH_DEVICE_ROUTE_PATH = `${PLUGIN_ROUTE_PREFIX}/switch-device`;
/** The pickable-device listing endpoint the picker refreshes on open. */
export const DEVICES_ROUTE_PATH = `${PLUGIN_ROUTE_PREFIX}/devices`;
/** The single control endpoint (tap/drag/button/type/rotate). */
export const CONTROL_ROUTE_PATH = `${PLUGIN_ROUTE_PREFIX}/control`;
/** The device-level action endpoint (notification shade, lock, …). */
export const DEVICE_ACTION_ROUTE_PATH = `${PLUGIN_ROUTE_PREFIX}/device-action`;
/** Only a fully online device can stream or take control ops. */
export function androidDeviceOnline(device) {
    return device.state === 'device';
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function optionalString(record, key) {
    const value = record[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}
function optionalFiniteNumber(record, key) {
    const value = record[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function parseDevice(value) {
    if (!isRecord(value))
        return {};
    return {
        ...(typeof value.serial === 'string' ? { serial: value.serial } : {}),
        ...(typeof value.name === 'string' ? { name: value.name } : {}),
        ...(typeof value.androidVersion === 'string' ? { androidVersion: value.androidVersion } : {}),
        ...(typeof value.state === 'string' ? { state: value.state } : {}),
    };
}
/**
 * Defensively parse the presentationMeta the host projected into
 * `ToolResultNode.meta`. Unknown or malformed shapes return `undefined` and
 * the card falls back to its plain fallback UI — never a throw.
 */
export function parseAndroidMeta(meta) {
    if (!isRecord(meta))
        return undefined;
    const device = parseDevice(meta.device);
    if (meta.kind === 'android-stream') {
        const streamRouteId = optionalString(meta, 'streamRouteId');
        return { kind: 'android-stream', device, ...(streamRouteId === undefined ? {} : { streamRouteId }) };
    }
    if (meta.kind === 'android-screenshot') {
        const path = optionalString(meta, 'path') ?? optionalString(meta, 'screenshotPath');
        if (path === undefined)
            return undefined;
        const screenshotPath = optionalString(meta, 'screenshotPath');
        return { kind: 'android-screenshot', path, ...(screenshotPath === undefined ? {} : { screenshotPath }), device };
    }
    if (meta.kind === 'android-build-run') {
        const packageName = optionalString(meta, 'packageName');
        const apkPath = optionalString(meta, 'apkPath');
        return {
            kind: 'android-build-run',
            device,
            ...(packageName === undefined ? {} : { packageName }),
            ...(apkPath === undefined ? {} : { apkPath }),
        };
    }
    return undefined;
}
const ROUTE_ERROR_COPY_KEYS = {
    forbidden: 'errForbidden',
    bad_method: 'errBadMethod',
    bad_content_type: 'errBadContentType',
    bad_request: 'errBadRequest',
    device_unknown: 'errDeviceUnknown',
    device_offline: 'errDeviceOffline',
    device_unauthorized: 'errDeviceUnauthorized',
    device_busy: 'errDeviceBusy',
    stream_not_running: 'errStreamNotRunning',
    stream_failed: 'errStreamFailed',
    token_invalid: 'errTokenInvalid',
    screenshot_missing: 'errScreenshotMissing',
    adb_unavailable: 'errAdbUnavailable',
    unavailable: 'errUnavailable',
};
/**
 * Localized text for a route failure: the code wins, the host's English
 * detail is the fallback. `copy` is the locale table (androidCopy(locale)) —
 * passed in rather than imported so this module stays copy-agnostic.
 */
export function androidRouteErrorTextOf(failure, copy) {
    const key = failure.code === undefined ? undefined : ROUTE_ERROR_COPY_KEYS[failure.code];
    const localized = key === undefined ? undefined : copy[key];
    return localized ?? failure.error;
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
/**
 * POST one JSON body and defensively read the answer. NEVER throws: a
 * transport failure, a non-2xx status and a malformed body all resolve to the
 * shared `GrantFailure` shape so every call site has exactly one branch.
 */
async function postJson(fetcher, path, body, routeLabel) {
    let response;
    try {
        response = await fetcher(path, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
            },
            body: JSON.stringify(body),
        });
    }
    catch (error) {
        return { ok: false, error: `${routeLabel} request failed: ${errorMessage(error)}` };
    }
    let value;
    try {
        value = await response.json();
    }
    catch {
        value = undefined;
    }
    if (!response.ok || !isRecord(value)) {
        const message = isRecord(value) && typeof value.error === 'string'
            ? value.error
            : `${routeLabel} endpoint returned HTTP ${response.status}`;
        const code = isRecord(value) && typeof value.code === 'string' ? value.code : undefined;
        return { ok: false, status: response.status, error: message, ...(code === undefined ? {} : { code }) };
    }
    return { ok: true, body: value };
}
function postGrant(fetcher, body) {
    return postJson(fetcher, GRANT_ROUTE_PATH, body, 'grant');
}
/**
 * The exact grant request body the stream surface sends. With a serial the
 * route starts (or reuses) the stream for that device; without one it falls
 * back to the device the session is already streaming.
 */
export function streamGrantBodyOf(input) {
    const serial = input.device?.serial;
    const session = typeof input.sessionId === 'string' && input.sessionId !== '' ? { sessionId: input.sessionId } : {};
    return typeof serial === 'string' && serial.trim() !== ''
        ? { kind: 'stream', device: serial, ...session }
        : { kind: 'stream', ...session };
}
/** POST the grant endpoint and read back the minted capability URL. */
export async function requestStreamGrant(fetcher, input) {
    const result = await postGrant(fetcher, streamGrantBodyOf(input));
    if (!result.ok)
        return result;
    const streamUrl = optionalString(result.body, 'streamUrl');
    if (streamUrl === undefined) {
        return { ok: false, error: 'grant response is missing streamUrl' };
    }
    const expiresAt = optionalFiniteNumber(result.body, 'expiresAt');
    const device = optionalString(result.body, 'device');
    return {
        ok: true,
        grant: {
            streamUrl,
            ...(expiresAt === undefined ? {} : { expiresAt }),
            ...(device === undefined ? {} : { device }),
        },
    };
}
/** The exact grant request body the screenshot surface sends. */
export function screenshotGrantBodyOf(path) {
    return { kind: 'screenshot', path };
}
/** POST the grant endpoint for one screenshot path in the plugin cache. */
export async function requestScreenshotGrant(fetcher, path) {
    const result = await postGrant(fetcher, screenshotGrantBodyOf(path));
    if (!result.ok)
        return result;
    const screenshotUrl = optionalString(result.body, 'screenshotUrl');
    if (screenshotUrl === undefined) {
        return { ok: false, error: 'grant response is missing screenshotUrl' };
    }
    const expiresAt = optionalFiniteNumber(result.body, 'expiresAt');
    return { ok: true, grant: { screenshotUrl, ...(expiresAt === undefined ? {} : { expiresAt }) } };
}
/**
 * POST the read-only status endpoint and defensively parse the snapshot.
 * The endpoint never starts a stream and never mints capability tokens.
 */
export async function requestAndroidStatus(fetcher, input = {}) {
    const session = typeof input.sessionId === 'string' && input.sessionId !== '' ? { sessionId: input.sessionId } : {};
    const body = typeof input.device === 'string' && input.device !== ''
        ? { device: input.device, ...session }
        : { ...session };
    const result = await postJson(fetcher, STATUS_ROUTE_PATH, body, 'status');
    if (!result.ok)
        return { running: false };
    return {
        running: result.body.running === true,
        ...(typeof result.body.serial === 'string' && result.body.serial !== '' ? { serial: result.body.serial } : {}),
        ...(typeof result.body.deviceName === 'string' && result.body.deviceName !== '' ? { deviceName: result.body.deviceName } : {}),
    };
}
/** The exact capture request body the toolbar sends (device optional). */
export function captureBodyOf(input) {
    const session = typeof input.sessionId === 'string' && input.sessionId !== '' ? { sessionId: input.sessionId } : {};
    return typeof input.device === 'string' && input.device.trim() !== ''
        ? { device: input.device, ...session }
        : { ...session };
}
/**
 * POST the capture endpoint and read back a freshly minted screenshot URL.
 * The route captures a NEW PNG of the current streamed (or explicitly named,
 * online) device — no prior presentationMeta path is involved.
 */
export async function requestAndroidCapture(fetcher, input = {}) {
    const result = await postJson(fetcher, CAPTURE_ROUTE_PATH, captureBodyOf(input), 'capture');
    if (!result.ok)
        return result;
    const screenshotUrl = optionalString(result.body, 'screenshotUrl');
    const path = optionalString(result.body, 'path');
    const bytes = optionalFiniteNumber(result.body, 'bytes');
    if (screenshotUrl === undefined || path === undefined || bytes === undefined) {
        return { ok: false, error: 'capture response is missing screenshotUrl, path or bytes' };
    }
    const expiresAt = optionalFiniteNumber(result.body, 'expiresAt');
    return { ok: true, capture: { screenshotUrl, path, bytes, ...(expiresAt === undefined ? {} : { expiresAt }) } };
}
/** The exact switch-device request body the panel picker sends. */
export function switchDeviceBodyOf(serial, sessionId) {
    return { device: serial, ...(typeof sessionId === 'string' && sessionId !== '' ? { sessionId } : {}) };
}
/**
 * POST the switch-device endpoint: the explicit user gesture that takes over
 * the stream slot for another ONLINE device and mints fresh relative
 * capability URLs for it. An offline/unauthorized target answers a coded 409
 * (this route never boots an AVD — that is `android_boot`).
 */
export async function requestSwitchDevice(fetcher, serial, sessionId) {
    const result = await postJson(fetcher, SWITCH_DEVICE_ROUTE_PATH, switchDeviceBodyOf(serial, sessionId), 'switch-device');
    if (!result.ok)
        return result;
    const streamUrl = optionalString(result.body, 'streamUrl');
    const device = optionalString(result.body, 'device');
    if (streamUrl === undefined || device === undefined) {
        return { ok: false, error: 'switch-device response is missing streamUrl or device' };
    }
    const expiresAt = optionalFiniteNumber(result.body, 'expiresAt');
    const deviceName = optionalString(result.body, 'deviceName');
    return {
        ok: true,
        switched: {
            streamUrl,
            ...(expiresAt === undefined ? {} : { expiresAt }),
            device,
            ...(deviceName === undefined ? {} : { deviceName }),
        },
    };
}
/**
 * POST the pickable-device listing endpoint and defensively parse the ONE
 * `devices` array plus the `avds` names. Always resolves (empty on failure) —
 * the picker degrades to the current device and retries on the next open.
 * Host-side ordering (online first, then serial) is preserved as-is.
 */
export async function requestAndroidDevices(fetcher, sessionId) {
    const body = typeof sessionId === 'string' && sessionId !== '' ? { sessionId } : {};
    const result = await postJson(fetcher, DEVICES_ROUTE_PATH, body, 'devices');
    if (!result.ok || !Array.isArray(result.body.devices))
        return { devices: [], avds: [] };
    const devices = [];
    for (const entry of result.body.devices) {
        if (!isRecord(entry))
            continue;
        const serial = optionalString(entry, 'serial');
        const state = optionalString(entry, 'state');
        if (serial === undefined || state === undefined)
            continue;
        const model = optionalString(entry, 'model');
        devices.push({
            serial,
            state,
            kind: entry.kind === 'emulator' ? 'emulator' : 'physical',
            ...(model === undefined ? {} : { model }),
            ...(entry.streaming === true ? { streaming: true } : {}),
        });
    }
    const avds = [];
    if (Array.isArray(result.body.avds)) {
        for (const entry of result.body.avds) {
            if (typeof entry === 'string' && entry !== '')
                avds.push(entry);
        }
    }
    return { devices, avds };
}
/** Hardware/navigation buttons `/control` accepts (host: ANDROID_BUTTONS). */
export const ANDROID_BUTTONS = [
    'home',
    'back',
    'recents',
    'power',
    'volume_up',
    'volume_down',
    'menu',
    'enter',
    'delete',
];
/** The exact control request body the panel sends. */
export function controlBodyOf(device, action, sessionId) {
    return { device, action, ...(typeof sessionId === 'string' && sessionId !== '' ? { sessionId } : {}) };
}
/**
 * POST the control endpoint. Fails fast with the route's coded error; the
 * panel treats control failures as non-fatal (a refused tap stays silent).
 */
export async function postAndroidControl(fetcher, device, action, sessionId) {
    const result = await postJson(fetcher, CONTROL_ROUTE_PATH, controlBodyOf(device, action, sessionId), 'control');
    if (!result.ok)
        return result;
    const rotation = optionalFiniteNumber(result.body, 'rotation');
    return { ok: true, result: { ...(rotation === undefined ? {} : { rotation }) } };
}
/** The device-level actions the host exposes (host: ANDROID_DEVICE_ACTIONS). */
export const ANDROID_DEVICE_ACTIONS = [
    'notifications',
    'quick-settings',
    'lock',
    'wake',
    'assistant',
];
/**
 * Run one device-level action. A coded failure comes back through the shared
 * failure shape and the menu keeps itself open for a retry.
 */
export async function postDeviceAction(fetcher, device, action, sessionId) {
    const body = {
        action,
        ...(device === undefined || device === '' ? {} : { device }),
        ...(typeof sessionId === 'string' && sessionId !== '' ? { sessionId } : {}),
    };
    const result = await postJson(fetcher, DEVICE_ACTION_ROUTE_PATH, body, 'device-action');
    if (!result.ok)
        return result;
    return { ok: true, action: optionalString(result.body, 'action') ?? action };
}
// ── pointer-gesture coalescing (one gesture → one control action) ────────────
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
export const ANDROID_TAP_SLOP = 0.02;
/** Minimum/maximum drag duration sent to the host (seconds). */
export const ANDROID_DRAG_DURATION_MIN_S = 0.05;
export const ANDROID_DRAG_DURATION_MAX_S = 2;
/** Trailing-edge sampling cadence for drag move bookkeeping (ms). */
export const ANDROID_DRAG_MOVE_SAMPLE_MS = 50;
/**
 * One gesture → one control action: tap when the pointer barely moved,
 * otherwise a single drag from anchor to release point over the (clamped)
 * gesture duration.
 */
export function androidGestureActionOf(start, end, durationMs) {
    const moved = Math.hypot(end.x - start.x, end.y - start.y);
    if (moved < ANDROID_TAP_SLOP)
        return { kind: 'tap', x: end.x, y: end.y };
    const duration = Math.min(ANDROID_DRAG_DURATION_MAX_S, Math.max(ANDROID_DRAG_DURATION_MIN_S, durationMs / 1000));
    return {
        kind: 'drag',
        fromX: start.x,
        fromY: start.y,
        toX: end.x,
        toY: end.y,
        durationMs: Math.round(duration * 1000),
    };
}
function clamp01(value) {
    return Math.min(1, Math.max(0, value));
}
/** Map a pointer event on an element to normalized 0..1 stream coordinates. */
export function normalizePointerPoint(event, bounds) {
    const width = bounds.width > 0 ? bounds.width : 1;
    const height = bounds.height > 0 ? bounds.height : 1;
    return {
        x: clamp01((event.clientX - bounds.left) / width),
        y: clamp01((event.clientY - bounds.top) / height),
    };
}
