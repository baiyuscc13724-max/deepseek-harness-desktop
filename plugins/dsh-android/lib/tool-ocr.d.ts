/**
 * Vision-OCR tools: `android_find_text`, `android_tap_text`, `android_wait_for`.
 *
 * The uiautomator hierarchy (tool-uitree.ts) stays the primary observer; these
 * three cover what it cannot see. On Android that gap is wide and common:
 * Jetpack Compose without `semantics`, Flutter, React Native's older bridge,
 * WebView content behind one opaque node, Unity/Unreal game surfaces, and
 * anything drawn into a `SurfaceView` all dump as a single unlabeled box. OCR
 * reads them anyway, because its only input is the PNG that
 * `adb exec-out screencap` already produces.
 *
 * COORDINATES: exactly one space. The helper emits boxes in image pixels, the
 * screenshot IS the display, and `AndroidHostController.tap` takes normalized
 * 0..1 of that same frame — so a tap is `center / screenshot size`, with no
 * point/pixel scale factor and no rotation inverse anywhere (the frame follows
 * the display rotation; docs/contract.zh.md). Rects are therefore reported in
 * PIXELS and can be reasoned about directly against android_ui_tree bounds.
 *
 * `android_wait_for` polls the same capture+OCR pipeline; a timeout is a
 * normal `matched:false` answer, never an error, so it can gate an action on a
 * condition without the model looping android_find_text by hand.
 * @module @zseven-w/dsh-android/tool-ocr
 */
import { type ToolDefinition } from '@deepseek-ai/dsh-tools';
import { type OcrItem, type OcrRect } from './ocr-backend.js';
import { type AndroidDeviceInfo, type AndroidToolHost, type AndroidUiToolsOptions, type OcrExpectationResult } from './tool-uitree.js';
/** Registered Vision-OCR tool names, in registration order. */
export declare const ANDROID_OCR_TOOL_NAMES: readonly ["android_find_text", "android_tap_text", "android_wait_for"];
/** Default minimum OCR confidence (0.3 — the useful floor for CJK labels). */
export declare const OCR_DEFAULT_MIN_CONFIDENCE = 0.3;
/** Validate/parse the optional min_confidence argument. */
export declare function sanitizeMinConfidence(value: number | undefined): number;
/** One `android_find_text` item (rect in image pixels). */
export interface AndroidFindTextItem {
    text: string;
    confidence: number;
    rect: OcrRect;
}
export interface AndroidFindTextResult {
    device: AndroidDeviceInfo;
    /** Screenshot size in PIXELS — the same space the rects live in. */
    screen: {
        width: number;
        height: number;
    };
    count: number;
    items: AndroidFindTextItem[];
    /** True when low-confidence items were dropped to fit the output cap. */
    truncated?: boolean;
    hint?: string;
}
export interface AndroidTapTextResult {
    action: 'tap-text';
    text: string;
    confidence: number;
    /** Matched text box in image pixels. */
    rect: OcrRect;
    /** Tapped point in image pixels. */
    center: {
        x: number;
        y: number;
    };
    /** The normalized 0..1 coordinates actually sent to the device. */
    tap: {
        x: number;
        y: number;
    };
    expected?: OcrExpectationResult;
    path: string;
    bytes: number;
    width?: number;
    height?: number;
    device: AndroidDeviceInfo;
}
/** One matched OCR item as `android_wait_for` reports it (pixels). */
export interface AndroidWaitForItem {
    text: string;
    confidence: number;
    rect: OcrRect;
}
/** A timeout is a normal `matched:false`, never a throw. */
export interface AndroidWaitForResult {
    device: AndroidDeviceInfo;
    matched: boolean;
    waitedMs: number;
    text: string;
    mode: 'appear' | 'disappear';
    item?: AndroidWaitForItem;
}
export interface AndroidOcrTools {
    androidFindText: ToolDefinition;
    androidTapText: ToolDefinition;
    androidWaitFor: ToolDefinition;
}
/**
 * Resolve one OCR text target with the SAME rules as android_tap_element:
 * exact (case-sensitive) equality first, then case-insensitive contains;
 * several distinct matches raise a candidate-list error (text + confidence +
 * rect, capped at 8).
 */
export declare function resolveOcrTextTarget(items: readonly OcrItem[], query: string,
/** Every OCR item BEFORE the confidence filter, for the near-miss report. */
unfiltered?: readonly OcrItem[], minConfidence?: number): {
    item: OcrItem;
    matchedBy: 'exact' | 'contains';
};
/** Create the three Vision-OCR tool definitions bound to one host. */
export declare function createAndroidOcrTools(host: AndroidToolHost, options?: AndroidUiToolsOptions): AndroidOcrTools;
