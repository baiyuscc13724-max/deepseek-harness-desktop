/**
 * Model-facing semantic UI tools: `android_ui_tree` dumps the frontmost
 * window's uiautomator view hierarchy (text, content-desc, resource-id,
 * class, pixel bounds, enabled/clickable/scrollable/focused flags) and
 * `android_tap_element` taps a node by IDENTITY — the agent reasons over real
 * UI semantics instead of guessing normalized coordinates off a screenshot.
 *
 * One backend, not two (docs/architecture.zh.md, decision 3): emulators and
 * physical devices both answer `adb shell uiautomator dump`, so there is no
 * WebDriverAgent/AXe split, no snapshot-depth ladder, and no helper to
 * install. The matching rules are the ones the dsh-ios twin proved out —
 * exact selector match first, then case-insensitive contains, nested
 * duplicates collapsed into one containment chain, an off-screen/disabled
 * gate before any tap, and an ambiguity error that LISTS the candidates —
 * they just read Android's resource-id / text / content-desc instead of iOS's
 * identifier / label (see uitree.ts, `resolveTapTarget`).
 *
 * After the tap the tool settles ~300 ms and captures a fresh screenshot with
 * exactly the same summary and presentationMeta shape as `android_interact`,
 * so the effect is visible in the transcript. `expect_text` / `expect_gone`
 * turn a tap and its verification into ONE round trip by polling the OCR path
 * (ocr-backend.ts) for up to ~4 s — the model should never screenshot-and-
 * compare pixels to find out whether a tap landed.
 *
 * This module also owns the plumbing the sibling tool modules share: the
 * screenshot store (a twin of the one in tools.ts, writing into the same
 * `stream-access.screenshotDir()` so every capture can be granted a signed
 * URL), the device summary + JSON schemas, and the OCR poll helpers.
 * @module @zseven-w/dsh-android/tool-uitree
 */
import { type JsonValue, type ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { AndroidDevice } from './adb.js';
import { type OcrItem } from './ocr-backend.js';
import { type UiBounds, type UiTreeNode, type UiTreeToolchain } from './uitree.js';
import { type AndroidImageRef, type AndroidVisionServices } from './vision.js';
import { type CaptureVisionInput } from './tool-support.js';
/** Registered UI tool names, in registration order. */
export declare const ANDROID_UI_TOOL_NAMES: readonly ["android_ui_tree", "android_tap_element"];
/** Settle delay after a tap, before the effect screenshot. */
export declare const TAP_SETTLE_MS = 300;
/**
 * Poll budget (ms) for a tap tool's `expect_text` / `expect_gone` assertion.
 * One capture+OCR round trip costs ~0.6–1 s on an emulator, so 4000 ms allows
 * a couple of polls without turning a tap into another full android_wait_for.
 */
export declare const TAP_EXPECTATION_BUDGET_MS = 4000;
/** Interval between OCR polls (screencap + Vision, ~0.6 s per round trip). */
export declare const OCR_POLL_INTERVAL_MS = 600;
/**
 * The subset of `AndroidHostController` every tool module here consumes.
 * Declaring it structurally keeps the smoke able to inject a fake host
 * without a device (the DI seam the dsh-ios tools use for `SimHostController`).
 */
export interface AndroidToolHost {
    toolchain: UiTreeToolchain;
    /** Explicit serial → streamed device → the only online device, else throw. */
    resolveTarget(serial?: string): Promise<AndroidDevice>;
    /** Tap at normalized 0..1 coordinates of the current frame. */
    tap(serial: string, x: number, y: number): Promise<void>;
    /** Capture a fresh PNG, independent of the stream loop. */
    screenshot(serial: string): Promise<{
        png: Buffer;
        width?: number;
        height?: number;
    }>;
}
/** Device summary carried by every tool result and presentationMeta. */
export interface AndroidDeviceInfo {
    serial: string;
    name?: string;
    androidVersion?: string;
    state: string;
}
export interface AndroidUiToolsOptions {
    /** Plugin-owned cache root for screenshots (default `<tmp>/dsh-android`). */
    cacheDir?: string;
    /** Optional attachments+llm services for native image delivery. */
    vision?: AndroidVisionServices;
}
/** The two `android_ui_*` tool definitions bound to one host controller. */
export interface AndroidUiTools {
    androidUiTree: ToolDefinition;
    androidTapElement: ToolDefinition;
}
export declare function errorMessage(error: unknown): string;
export declare function sleep(milliseconds: number): Promise<void>;
/**
 * Flatten negative zero. `-0` does NOT survive a JSON round trip
 * (`stringify` writes `0`), so DSH's lossless boundary would reject the WHOLE
 * tool result rather than the one coordinate. Every rounded number these
 * modules emit goes through here.
 */
export declare function losslessNumber(value: number): number;
export declare function round2(value: number): number;
/** Normalized coordinates are reported at 4 decimals (sub-pixel on any phone). */
export declare function round4(value: number): number;
export declare function renderJson(_args: unknown, value: unknown): [{
    type: 'text';
    text: string;
}];
/** Compact summary of one adb device row (no extra round trip). */
export declare function deviceSummaryOf(device: AndroidDevice): AndroidDeviceInfo;
/** Shared device object schema — one stable shape across every tool. */
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
        };
        readonly androidVersion: {
            readonly type: "string";
        };
        readonly state: {
            readonly type: "string";
            readonly required: true;
        };
    };
};
/** A box in display pixels (bounds and row frames share the shape). */
export declare const boundsSchema: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly properties: {
        readonly x: {
            readonly type: "number";
            readonly required: true;
        };
        readonly y: {
            readonly type: "number";
            readonly required: true;
        };
        readonly w: {
            readonly type: "number";
            readonly required: true;
        };
        readonly h: {
            readonly type: "number";
            readonly required: true;
        };
    };
};
export declare const pointSchema: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly properties: {
        readonly x: {
            readonly type: "number";
            readonly required: true;
        };
        readonly y: {
            readonly type: "number";
            readonly required: true;
        };
    };
};
export declare const sizeSchema: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly properties: {
        readonly width: {
            readonly type: "number";
            readonly required: true;
        };
        readonly height: {
            readonly type: "number";
            readonly required: true;
        };
    };
};
export declare const expectedSchema: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly properties: {
        readonly text: {
            readonly type: "string";
            readonly required: true;
        };
        readonly mode: {
            readonly type: "string";
            readonly required: true;
            readonly enum: readonly ["appear", "disappear"];
        };
        readonly matched: {
            readonly type: "boolean";
            readonly required: true;
        };
        readonly waitedMs: {
            readonly type: "integer";
            readonly required: true;
        };
    };
};
/**
 * Stable per-device screenshot paths, in the SAME directory the panel capture
 * route serves: `<cacheDir>/screenshots/screenshot-<serial>-<n>.png`, where
 * the default `cacheDir` makes that exactly `stream-access.screenshotDir()`.
 * Three independent counters share that directory (this store, the twin in
 * tools.ts, and the capture route), so a name that already exists on disk is
 * skipped — a later writer can never overwrite a capture whose signed URL is
 * still live.
 */
export declare class ScreenshotStore {
    #private;
    constructor(cacheDir: string);
    nextPath(serial: string): string;
}
/** Read PNG dimensions from the IHDR chunk (best effort, 24-byte header). */
export declare function readPngSize(path: string): {
    width: number;
    height: number;
} | undefined;
/** One captured screenshot, in the summary shape every visual tool returns. */
export interface ScreenshotCapture {
    path: string;
    bytes: number;
    width?: number;
    height?: number;
    device: AndroidDeviceInfo;
    image?: AndroidImageRef;
}
/** Capture one screenshot into the store (same summary as android_screenshot). */
export declare function captureScreenshot(tool: string, store: ScreenshotStore, host: AndroidToolHost, device: AndroidDevice, vision?: CaptureVisionInput): Promise<ScreenshotCapture>;
/** Screenshot presentation envelope — identical across every visual tool. */
export declare function screenshotMeta(value: unknown): JsonValue;
/** The optional post-tap outcome assertion (expect_text / expect_gone). */
export interface OcrExpectationResult {
    text: string;
    mode: 'appear' | 'disappear';
    matched: boolean;
    waitedMs: number;
}
/** One poll cycle's answer, shared by android_wait_for and the tap tools. */
export interface OcrPollOutcome {
    matched: boolean;
    waitedMs: number;
    /** The matched OCR item, in image PIXELS. */
    item?: OcrItem;
}
/** Resolve the compiled Vision helper and OCR one PNG into parsed items. */
export declare function runOcr(tool: string, imagePath: string, deviceLabel: string, signal?: AbortSignal): Promise<OcrItem[]>;
/** One capture+OCR round trip: items plus the screenshot's pixel size. */
export interface OcrSnapshot {
    items: OcrItem[];
    pixelSize: {
        width: number;
        height: number;
    };
    path: string;
    bytes: number;
    device: AndroidDeviceInfo;
}
/** Screenshot pixel size is REQUIRED for OCR coordinate math. */
export declare function requirePixelSize(shot: ScreenshotCapture, tool: string): {
    width: number;
    height: number;
};
/** The shared capture+OCR pipeline (`android_find_text`'s, reused everywhere). */
export declare function readOcrOnce(tool: string, store: ScreenshotStore, host: AndroidToolHost, device: AndroidDevice, signal?: AbortSignal): Promise<OcrSnapshot>;
/** True when any OCR item matches the text (exact first, then contains). */
export declare function ocrTextPresent(items: readonly OcrItem[], text: string): OcrItem | undefined;
/**
 * Poll the OCR path until `text` appears or disappears (or the budget runs
 * out). One shared helper for `android_wait_for` and the tap tools'
 * `expect_text` / `expect_gone` assertions — a timeout is a normal
 * `matched: false`, never a throw. `read` is the injectable capture+OCR seam
 * (the tools pass a closure over `readOcrOnce`; the smoke passes a stub).
 */
export declare function pollForText(read: () => Promise<readonly OcrItem[]>, text: string, mode: 'appear' | 'disappear', timeoutMs: number, intervalMs: number, minConfidence: number, signal?: AbortSignal): Promise<OcrPollOutcome>;
/** Which expectation the tap args carry, or undefined when absent. */
export declare function tapExpectation(args: {
    expect_text?: string;
    expect_gone?: string;
}): {
    text: string;
    mode: 'appear' | 'disappear';
} | undefined;
/** The tap tools' post-settle outcome assertion, via the shared poll helper. */
export declare function runTapExpectation(tool: string, store: ScreenshotStore, host: AndroidToolHost, device: AndroidDevice, text: string, mode: 'appear' | 'disappear', signal?: AbortSignal): Promise<OcrExpectationResult>;
export interface AndroidUiTreeResult {
    device: AndroidDeviceInfo;
    /** Display size in pixels, taken from the hierarchy root bounds. */
    screen: {
        width: number;
        height: number;
    };
    /** Number of nodes in the returned (possibly pruned) tree. */
    nodeCount: number;
    /** True when the 40 KB cap pruned the deepest levels. */
    truncated?: boolean;
    /** Guidance: why the read looks the way it does, and what to do next. */
    hint?: string;
    /** Compact node tree (recursive; JSON-object typed for the canonical value). */
    tree: Array<Record<string, JsonValue>>;
}
export interface AndroidTapElementResult {
    action: 'tap-element';
    element: {
        type: string;
        text?: string;
        contentDesc?: string;
        resourceId?: string;
        bounds: UiBounds;
    };
    /** Tapped point in display pixels. */
    center: {
        x: number;
        y: number;
    };
    /** The normalized 0..1 coordinates actually sent to the device. */
    tap: {
        x: number;
        y: number;
    };
    /** Outcome assertion (expect_text/expect_gone), when requested. */
    expected?: OcrExpectationResult;
    path: string;
    bytes: number;
    width?: number;
    height?: number;
    device: AndroidDeviceInfo;
}
/** The case-(c) hint: a deep unfiltered read with no labels at all. */
export declare const OCR_FALLBACK_HINT: string;
/**
 * Assemble one `android_ui_tree` result: compact build (filter/max_depth) →
 * ~40 KB cap → node count and a hint computed from what was actually
 * RETURNED. An unlabeled read is attributed to one of three causes — the
 * filter, the cap, or the app itself — and only the third is ever reported as
 * "this screen exposes no accessibility information" (the WP63 discipline the
 * dsh-ios twin established).
 */
export declare function buildTreeResult(roots: readonly UiTreeNode[], screen: {
    width: number;
    height: number;
}, device: AndroidDeviceInfo, args: {
    max_depth?: number;
    filter?: string;
}): AndroidUiTreeResult;
/** Create the two `android_ui_*` tool definitions bound to one host. */
export declare function createAndroidUiTools(host: AndroidToolHost, options?: AndroidUiToolsOptions): AndroidUiTools;
