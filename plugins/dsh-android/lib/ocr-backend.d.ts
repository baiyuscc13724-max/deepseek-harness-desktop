/**
 * Vision OCR helper resolution, compilation, execution, and coordinate
 * conversion — the backend of `android_find_text` / `android_tap_text` /
 * `android_wait_for`.
 *
 * The uiautomator view hierarchy stays the primary UI-inspection source; OCR
 * covers what it cannot see: screens with no view hierarchy at all (Unity/
 * Unreal/Flutter-impeller surfaces, game canvases, `SurfaceView` video),
 * WebView content that reports one opaque node, text rendered as graphics
 * (badge counts, prices baked into images), and independent verification of
 * what is actually on screen.
 *
 * The helper is a plugin-owned Swift source (`assets/ocr.swift`, Vision's
 * `VNRecognizeTextRequest`, accurate, zh-Hans + en-US) compiled ON FIRST
 * USE into the plugin cache:
 *
 *     ~/Library/Caches/dsh-android/bin/ocr/<sha256(source)[0..16]>/ocr
 *
 * The cache key is the source hash, so an edited helper recompiles into a
 * fresh slot; the compiled binary's digest is recorded next to it and
 * re-checked on every resolution, so a corrupted artifact is rebuilt.
 * The helper runs on the HOST, on a PNG the plugin already captured through
 * `adb exec-out screencap`, so it needs nothing from the device — but it does
 * need macOS: Vision is an Apple framework. On any other host the tools fail
 * with an explanatory error instead of pretending to degrade.
 *
 * COORDINATE SPACE: unlike the iOS twin this module has exactly ONE space.
 * The helper emits boxes in IMAGE PIXELS (origin top-left), the Android
 * screenshot IS the display in pixels, and `AndroidHostController.tap` takes
 * normalized 0..1 of that same frame — so the only conversion needed is a
 * division by the screenshot's own pixel size. There is no point/pixel scale
 * factor anywhere in the Android path (docs/architecture.zh.md, decision 2).
 * @module @zseven-w/dsh-android/ocr-backend
 */
/** Install hint appended to every helper-unavailable tool error. */
export declare const OCR_INSTALL_HINT: string;
/** Where the resolved OCR helper came from. */
export type OcrBinarySource = 'path' | 'cache' | 'unavailable';
/** One resolved OCR helper binary. */
export interface OcrBinary {
    available: boolean;
    source: OcrBinarySource;
    /** Absolute path of the executable (when available). */
    command?: string;
    /** Why resolution failed (when unavailable). */
    reason?: string;
    /** One-line install hint for the model (always set when unavailable). */
    installHint: string;
    /** True when everything needed to compile the bundled helper exists. */
    compilable?: boolean;
}
/** One OCR box: image pixels, origin top-left. */
export interface OcrRect {
    x: number;
    y: number;
    w: number;
    h: number;
}
/** One recognized text item (box in image pixels). */
export interface OcrItem {
    text: string;
    confidence: number;
    rect: OcrRect;
}
/** A size in image pixels. */
export interface PixelSize {
    width: number;
    height: number;
}
/** Plugin cache base dir for the compiled helper. */
export declare function ocrCacheBase(): string;
/**
 * Resolve the bundled Swift source (`assets/ocr.swift`): an explicit
 * `DSH_ANDROID_OCR_SWIFT` override wins — and a bad override FAILS instead of
 * silently falling through — then the path relative to this compiled module
 * (works from `lib/` in the repo and inside the installed package), then a
 * cwd-relative fallback for development working copies.
 */
export declare function resolveOcrSwiftSource(): {
    path?: string;
    reason?: string;
};
/**
 * Resolve the OCR helper synchronously: host platform + source file + swiftc
 * probe + cache digest validation. Never compiles; `ensureOcrBinary()` adds
 * the compile-on-first-use step.
 */
export declare function resolveOcrBinary(): OcrBinary;
/** Run the compiled helper. Non-zero exits raise with its stderr/stdout. */
export declare function execOcr(binary: OcrBinary, imagePath: string, signal?: AbortSignal, timeoutMs?: number): Promise<{
    stdout: string;
    stderr: string;
}>;
/**
 * Resolve the helper, compiling the bundled source into the plugin cache
 * when it is absent (macOS with swiftc only). Resolution-only failure is
 * never fatal here: the returned object carries the reason and the install
 * hint for the tool to throw.
 */
export declare function ensureOcrBinary(): Promise<OcrBinary>;
/** Parse the helper's JSON payload into sanitized items (confidence-sorted). */
export declare function parseOcrOutput(stdout: string): OcrItem[];
/**
 * Filter OCR items: case-insensitive substring on the query and a
 * minimum-confidence floor. Empty/absent query keeps everything.
 */
export declare function filterOcrItems(items: readonly OcrItem[], query?: string, minConfidence?: number): OcrItem[];
/**
 * Pixel box → normalized 0..1 box. Only the screenshot's own pixel size
 * matters: `AndroidHostController.tap` multiplies by the live frame size
 * itself, and the frame IS the display.
 */
export declare function pixelRectToNormalized(rect: OcrRect, pixelSize: PixelSize): OcrRect;
/** Inverse of `pixelRectToNormalized` (normalized 0..1 → image pixels). */
export declare function normalizedRectToPixels(rect: OcrRect, pixelSize: PixelSize): OcrRect;
/** Center of a box (any space; the unit carries through). */
export declare function rectCenter(rect: OcrRect): {
    x: number;
    y: number;
};
/** Pixel box center → normalized 0..1 tap coordinates. */
export declare function pixelRectToNormalizedCenter(rect: OcrRect, pixelSize: PixelSize): {
    x: number;
    y: number;
};
