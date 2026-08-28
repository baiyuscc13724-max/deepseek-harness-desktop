/**
 * Shared runtime for the model-facing Android tools: device resolution, the
 * screenshot store, the interaction router, and the schemas every result
 * shape reuses.
 *
 * This is the layer dsh-ios kept inline in its (1742-line) tools.ts. Here it
 * is its own module so the tool DEFINITIONS stay readable and so the UI/OCR/
 * row tool families can share exactly one screenshot layout and one device
 * summary — three independent capture paths writing into one directory is a
 * real overwrite hazard (see `ScreenshotStore`), and it only stays safe while
 * they all go through this code.
 *
 * Everything here is re-exported from `./tools.js`, which is the import path
 * the sibling tool modules use.
 * @module @zseven-w/dsh-android/tool-support
 */
import type { JsonValue } from '@deepseek-ai/dsh-tools';
import type { AndroidDevice, AndroidDeviceDetails } from './adb.js';
import { type AndroidHostController } from './android-host.js';
import { type AndroidImageRef, type AndroidVisionServices, type VisionExecLike } from './vision.js';
/** The device summary every tool result carries. */
export interface AndroidDeviceInfo {
    serial: string;
    /** Marketing model when the device answers getprop, else the serial. */
    name: string;
    /** `ro.build.version.release`, or '' when the device did not answer. */
    androidVersion: string;
    /** adb connection state (`device`, `offline`, `unauthorized`, …). */
    state: string;
}
/** Screenshot summary — the value the tools return instead of image bytes.
 * On an image-capable route `image` carries the durable attachment ref and
 * the render layer delivers the screenshot to the model as an image block. */
export interface AndroidScreenshotResult {
    path: string;
    bytes: number;
    width?: number;
    height?: number;
    device: AndroidDeviceInfo;
    image?: AndroidImageRef;
}
/** The services+exec pair a capture site passes to opt into image delivery. */
export interface CaptureVisionInput {
    services: AndroidVisionServices;
    exec: VisionExecLike;
}
/**
 * Resolve the optional image attachment for one captured PNG: only on an
 * image-capable route with a mounted store, and NEVER an error — any failure
 * keeps the text-only result (degrade, don't refuse).
 */
export declare function screenshotImageRef(vision: CaptureVisionInput | undefined, png: Uint8Array, name: string): Promise<AndroidImageRef | undefined>;
export type AndroidInteractAction = 'tap' | 'type' | 'button' | 'gesture' | 'scroll';
export interface AndroidInteractArgs {
    device?: string;
    action: AndroidInteractAction;
    x?: number;
    y?: number;
    text?: string;
    name?: string;
    json?: JsonValue;
    direction?: 'up' | 'down' | 'left' | 'right';
    amount?: number;
}
/** Settle delay after an interaction, before the effect screenshot. */
export declare const INTERACT_SETTLE_MS = 300;
/**
 * The band every scroll stays inside, as a fraction of the travelling axis.
 * Android's gesture navigation owns the bottom strip (back/home/recents swipe)
 * and both side edges (back gesture), and a swipe that starts inside one of
 * those is eaten by the system before the app ever sees it. dsh-ios clamps to
 * the same 8%..92% for the home-indicator strip.
 */
export declare const SCROLL_BAND_MIN = 0.08;
export declare const SCROLL_BAND_MAX = 0.92;
/** Seconds one scroll's `input swipe` takes — fast enough to read as a flick. */
export declare const SCROLL_DURATION_S = 0.3;
export declare const SCROLL_DIRECTIONS: readonly ["up", "down", "left", "right"];
export declare const INTERACT_ACTIONS: readonly ["tap", "type", "button", "gesture", "scroll"];
export declare function sleep(milliseconds: number): Promise<void>;
export declare function errorMessage(error: unknown): string;
export declare function renderJson(_args: unknown, value: unknown): [{
    type: 'text';
    text: string;
}];
/**
 * Shared device object schema used by every tool result. Kept `as const` so
 * `defineTool` can infer the concrete output value type (an interface-typed
 * schema would widen to an empty object under the DSL's inference).
 */
export declare const deviceSchema: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly properties: {
        readonly serial: {
            readonly type: "string";
            readonly required: true;
        };
        readonly name: {
            readonly type: "string";
            readonly required: true;
        };
        readonly androidVersion: {
            readonly type: "string";
            readonly required: true;
        };
        readonly state: {
            readonly type: "string";
            readonly required: true;
        };
    };
};
/** One installed package, as `android_list_apps` reports it. */
export declare const appSchema: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly properties: {
        readonly packageName: {
            readonly type: "string";
            readonly required: true;
        };
        readonly label: {
            readonly type: "string";
            readonly required: true;
        };
        readonly version: {
            readonly type: "string";
        };
        readonly versionCode: {
            readonly type: "integer";
        };
        readonly system: {
            readonly type: "boolean";
            readonly required: true;
        };
        readonly apkPath: {
            readonly type: "string";
        };
    };
};
/** Degradation guard: throws the explanatory error when adb is unresolvable. */
export declare function assertAdbAvailable(host: AndroidHostController, tool: string): void;
/** The device summary a tool result carries, from a listing row + getprop. */
export declare function deviceSummary(device: AndroidDevice, details?: AndroidDeviceDetails): AndroidDeviceInfo;
/**
 * Resolve the device a tool operates on and enrich it for the result. The
 * resolution itself lives in the host (explicit serial → streamed → the only
 * online device → an explanatory throw); this only adds the getprop details
 * every result shape wants, and re-prefixes the error with the calling tool.
 */
export declare function resolveTarget(host: AndroidHostController, tool: string, serial: string | undefined): Promise<{
    device: AndroidDevice;
    summary: AndroidDeviceInfo;
}>;
/**
 * Per-device screenshot paths inside the SHARED cache directory
 * (`<tmp>/dsh-android/screenshots/screenshot-<serial>-<n>.png`, the exact
 * directory the signed screenshot route serves).
 *
 * Three independent counters write into that directory — this store, the UI
 * tools' twin, and the panel capture route — so each scans the directory once
 * and their counters collide. Skipping names that already exist on disk is
 * what keeps a later write from overwriting an earlier capture whose signed
 * URL is still live.
 */
export declare class ScreenshotStore {
    #private;
    constructor(root: string);
    /** The directory captures land in (shared with the screenshot route). */
    get root(): string;
    nextPath(serial: string): string;
}
/** Capture one PNG into the store and summarize it (never image bytes). */
export declare function captureScreenshot(host: AndroidHostController, store: ScreenshotStore, tool: string, device: AndroidDevice, summary: AndroidDeviceInfo, vision?: CaptureVisionInput): Promise<AndroidScreenshotResult>;
/** Screenshot presentation envelope — stable, replayable identifiers only. */
export declare function screenshotMeta(value: unknown): JsonValue;
/** One scroll's finger path in normalized 0..1 frame coordinates. */
export interface ScrollPath {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
}
/**
 * The finger path of one scroll. The direction names the CONTENT, matching
 * dsh-ios: `down` reveals content further down the page, which is the finger
 * moving UP (a smaller y). Both endpoints are clamped into the
 * system-gesture-free band, so a swipe can never begin (or end) in Android's
 * navigation strip where the shell would swallow it.
 */
export declare function androidScrollPath(args: AndroidInteractArgs): ScrollPath;
/**
 * Validate a `gesture` payload into a normalized drag. Android has one gesture
 * primitive (`input swipe`), so a gesture IS a drag — a raw single-frame
 * `{type,x,y}` payload (which serve-sim accepted on iOS) has no meaning here
 * and is refused with the shape that does work.
 */
export declare function gestureDragOf(json: JsonValue | undefined): {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    duration: number;
};
/**
 * Perform one validated interaction against the device. Every branch validates
 * BEFORE touching the device, so an argument mistake never lands a half
 * gesture on a real phone.
 */
export declare function performInteract(host: AndroidHostController, serial: string, args: AndroidInteractArgs): Promise<void>;
