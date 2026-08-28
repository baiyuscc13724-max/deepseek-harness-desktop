/**
 * Signed web-route layer for the dsh-android live device stream.
 *
 * Everything crosses the DSH webserver origin through plugin-owned routes
 * under `/_dsh/dsh-android/`; the browser never sees an adb port because
 * there is none — the stream is produced in-process (frame-source.ts) and
 * served straight from the latest-frame buffer:
 *
 * - `GET  /stream/<token>`     — live `multipart/x-mixed-replace` PNG stream
 *   of the streamed device, written from the in-process frame loop.
 * - `GET  /screenshot/<token>` — one PNG from the plugin's screenshot cache
 *   (absolute paths outside it are refused).
 * - `POST /grant`              — loopback/trusted-only endpoint the client
 *   card calls at render time to re-mint fresh capabilities from stable
 *   presentationMeta. Never boots an emulator; it only starts the frame
 *   loop for a device that is already online.
 * - `POST /switch-device`      — the panel picker's explicit user gesture:
 *   switches which ONLINE device streams. Unlike dsh-ios (where a pick may
 *   boot a simulator in seconds), booting an Android emulator takes minutes
 *   and is not tied to a serial until it appears, so AVD boot stays with
 *   the android_boot tool; this route answers 409 for offline targets.
 * - `POST /devices`            — read-only listing: one array of adb devices
 *   (emulators and phones both stream) plus the machine's AVD names.
 * - `POST /capture`            — capture a FRESH PNG into the screenshot
 *   cache and mint a signed URL. Never starts anything.
 * - `POST /status`             — read-only `{ running, serial?, deviceName? }`
 *   for the input-dock capsule; never starts a stream, never mints tokens.
 * - `POST /control`            — one control op `{ serial, action }` where
 *   action is tap/drag (NORMALIZED 0..1 panel coordinates), button (Android
 *   three-button navigation and hardware keys), type, or rotate (advances
 *   the user_rotation cycle). One route for every device kind — adb does
 *   not distinguish emulators from phones and neither do we.
 * - `POST /device-action`      — notification shade, quick settings, lock,
 *   wake, assistant.
 *
 * Tokens, the loopback/trusted fence, and the screenshot containment walk
 * live in stream-access.ts (ported from dsh-ios unchanged in posture).
 * @module @zseven-w/dsh-android/stream-routes
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import { type AndroidDevice } from './adb.js';
import { AndroidHostRegistry, type AndroidHostController } from './android-host.js';
import { StreamAccessController } from './stream-access.js';
/** HTTP prefix owned by the dsh-android web routes. */
export declare const PLUGIN_ROUTE_PREFIX = "/_dsh/dsh-android";
export declare const STREAM_ROUTE_PREFIX = "/_dsh/dsh-android/stream";
export declare const SCREENSHOT_ROUTE_PREFIX = "/_dsh/dsh-android/screenshot";
export declare const GRANT_ROUTE_PATH = "/_dsh/dsh-android/grant";
export declare const SWITCH_DEVICE_ROUTE_PATH = "/_dsh/dsh-android/switch-device";
export declare const DEVICES_ROUTE_PATH = "/_dsh/dsh-android/devices";
export declare const CAPTURE_ROUTE_PATH = "/_dsh/dsh-android/capture";
export declare const STATUS_ROUTE_PATH = "/_dsh/dsh-android/status";
export declare const CONTROL_ROUTE_PATH = "/_dsh/dsh-android/control";
export declare const DEVICE_ACTION_ROUTE_PATH = "/_dsh/dsh-android/device-action";
/**
 * Stable machine-readable reasons for a refused route call. The English
 * `message` stays the developer-facing detail; the client localizes off the
 * code (the host cannot know which language the browser shows).
 */
export type AndroidRouteErrorCode = 'forbidden' | 'bad_method' | 'bad_content_type' | 'bad_request' | 'device_unknown' | 'device_offline' | 'device_unauthorized' | 'device_busy' | 'stream_not_running' | 'stream_failed' | 'token_invalid' | 'screenshot_missing' | 'adb_unavailable' | 'unavailable';
/** The route-level code for one known-but-not-online device state. */
export declare function deviceStateErrorCode(state: AndroidDevice['state']): AndroidRouteErrorCode;
/** The next capture path for `serial` inside the shared screenshot cache. */
export declare function nextCapturePath(serial: string): Promise<string>;
/** Minimal structural face of the webserver service (also lets the smoke
 * scripts mount the same handlers on a plain node:http server). */
export interface StreamRouteMount {
    register(route: {
        kind: 'exact' | 'prefix';
        path: string;
        handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
    }): () => void;
}
/**
 * Owns the plugin's signed routes: verifies capabilities, serves the live
 * frame stream from the in-process loop, and tracks every open response so
 * disposal can destroy them all.
 */
export declare class StreamRoutes {
    #private;
    readonly host: AndroidHostController | AndroidHostRegistry;
    readonly access: StreamAccessController;
    constructor(host: AndroidHostController | AndroidHostRegistry, access: StreamAccessController);
    get routeAvailable(): boolean;
    /** `GET /_dsh/dsh-android/stream/<token>` — live multipart PNG stream. */
    handleStream(req: IncomingMessage, res: ServerResponse): Promise<void>;
    /** `GET /_dsh/dsh-android/screenshot/<token>` — serve one cached PNG. */
    handleScreenshot(req: IncomingMessage, res: ServerResponse): Promise<void>;
    /**
     * `POST /_dsh/dsh-android/grant` — mint fresh relative-URL capabilities
     * from stable presentationMeta. Never boots an emulator: a stream is only
     * started for a device that is already ONLINE, and minting never yanks the
     * stream away from a different streaming device (device switches belong
     * exclusively to the explicit gesture behind /switch-device).
     */
    handleGrant(req: IncomingMessage, res: ServerResponse): Promise<void>;
    /**
     * `POST /_dsh/dsh-android/switch-device` — switch which device the panel
     * streams. The explicit user gesture authorizes taking over the stream
     * slot; the target must be ONLINE (this route never boots an emulator —
     * an AVD boot takes minutes and belongs to the android_boot tool).
     */
    handleSwitchDevice(req: IncomingMessage, res: ServerResponse): Promise<void>;
    /**
     * `POST /_dsh/dsh-android/devices` — read-only listing for the picker:
     * one array of adb devices (every online one can stream — emulators and
     * phones alike) plus the machine's AVD names for context. Never boots,
     * never starts a stream, never mints tokens.
     */
    handleDevices(req: IncomingMessage, res: ServerResponse): Promise<void>;
    /**
     * `POST /_dsh/dsh-android/capture` — capture a FRESH PNG of the streamed
     * (or explicitly named, online) device into the shared screenshot cache
     * and mint a signed relative URL. Never boots or starts a stream.
     */
    handleCapture(req: IncomingMessage, res: ServerResponse): Promise<void>;
    /**
     * `POST /_dsh/dsh-android/status` — read-only stream snapshot for the
     * input dock's capsule. NEVER starts a stream and never mints tokens.
     */
    handleStatus(req: IncomingMessage, res: ServerResponse): Promise<void>;
    /**
     * `POST /_dsh/dsh-android/control` — one control op against the streamed
     * device. Body `{ device, action }` with `{kind:'tap'|'drag'|'button'|
     * 'type'|'rotate'}`; tap/drag coordinates are NORMALIZED 0..1 of the
     * streamed frame. `rotate` advances the user_rotation cycle and reports
     * the new rotation (0..3). The device must be streaming or at least
     * online; nothing is booted here.
     */
    handleControl(req: IncomingMessage, res: ServerResponse): Promise<void>;
    /** `POST /_dsh/dsh-android/device-action` — run one device-level action. */
    handleDeviceAction(req: IncomingMessage, res: ServerResponse): Promise<void>;
    /** Destroy every open stream response. */
    dispose(): void;
}
/**
 * Register the plugin routes on any webserver-shaped carrier. Exported
 * separately from installStreamRoutes so smoke scripts can mount the same
 * handlers on a plain node:http server without mocking a cordis Context.
 */
export declare function mountStreamRoutes(webServer: StreamRouteMount, routes: StreamRoutes): () => void;
/**
 * Mount the stream routes on the optional `webServer` service. Uses
 * `ctx.inject` + `ctx.effect` so headless profiles (no webServer) still
 * load, the routes are registered exactly once, and disposal unregisters
 * them and destroys every open stream.
 */
export declare function installStreamRoutes(ctx: Context, host: AndroidHostController | AndroidHostRegistry): void;
