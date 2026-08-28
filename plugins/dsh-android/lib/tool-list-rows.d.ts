/**
 * List/feed row tools: `android_ui_rows` and `android_tap_row`.
 *
 * A `RecyclerView` item is a subtree, not an element: its title, subtitle and
 * counters live in scattered TextViews, and its per-item controls (like,
 * bookmark, share) are commonly unlabeled `ImageView`s with neither
 * resource-id nor content-desc. `android_tap_element` cannot reach them —
 * there is no identity to match. These two tools close that gap:
 *
 * `android_ui_rows` turns the dump into ROWS — index, pixel frame, the
 * aggregated label, and the counters parsed GENERICALLY out of that label
 * (number + classifier token, 中文/English; no app vocabulary is hardcoded —
 * see list-rows.ts).
 * `android_tap_row` taps at a RELATIVE position inside row N (fractions of the
 * row frame) instead of guessing absolute screen coordinates, and can verify
 * the action the only reliable way a list app offers: the target counter
 * moving the expected ±1 (`expect_count`).
 *
 * Real-device safety gate: a tap is planned from a FRESH dump, an out-of-range
 * row index FAILS instead of clamping, an `expect_count` key the row's
 * counters do not contain is refused BEFORE any tap (that is exactly the
 * probe-click failure mode on a real account), and verification reports
 * unverified-with-reason instead of guessing.
 * @module @zseven-w/dsh-android/tool-list-rows
 */
import { type ToolDefinition } from '@deepseek-ai/dsh-tools';
import { type CountCheckResult } from './list-rows.js';
import { type AndroidDeviceInfo, type AndroidToolHost, type AndroidUiToolsOptions } from './tool-uitree.js';
/** Registered list-row tool names, in registration order. */
export declare const ANDROID_ROW_TOOL_NAMES: readonly ["android_ui_rows", "android_tap_row"];
/** One row in the output schema (shared by both tools). */
export interface AndroidRowOutput {
    index: number;
    type: string;
    frame: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
    label?: string;
    counts: Array<{
        key: string;
        value: number;
    }>;
    group?: number;
}
export interface AndroidUiRowsResult {
    device: AndroidDeviceInfo;
    /** Display size in pixels (the space row frames live in). */
    screen: {
        width: number;
        height: number;
    };
    rowCount: number;
    repeatedGroups: number;
    omittedOffscreen: number;
    rows: AndroidRowOutput[];
    truncated?: boolean;
    hint?: string;
    note?: string;
}
export interface AndroidTapRowResult {
    action: 'tap-row';
    row: AndroidRowOutput;
    /** Relative position inside the row frame (0..1) that was tapped. */
    inRow: {
        x: number;
        y: number;
    };
    /** Absolute tap point in display pixels. */
    center: {
        x: number;
        y: number;
    };
    /** The normalized 0..1 coordinates actually sent to the device. */
    tap: {
        x: number;
        y: number;
    };
    /** Count-change verification, when expect_count was given. */
    countCheck?: CountCheckResult;
    path: string;
    bytes: number;
    width?: number;
    height?: number;
    device: AndroidDeviceInfo;
    note?: string;
}
export interface AndroidRowTools {
    androidUiRows: ToolDefinition;
    androidTapRow: ToolDefinition;
}
/** Create the two `android_*_row(s)` tool definitions bound to one host. */
export declare function createAndroidRowTools(host: AndroidToolHost, options?: AndroidUiToolsOptions): AndroidRowTools;
