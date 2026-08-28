/**
 * Row-level abstraction for list/feed apps.
 *
 * A `RecyclerView` (or `ListView`, or a Compose `LazyColumn` that surfaces as
 * one) hands uiautomator a run of structurally IDENTICAL sibling subtrees, one
 * per item. Everything the item says — title, subtitle, and its counters
 * ("57 回复。18 喜欢。592 次查看") — lives in TextViews scattered inside that
 * subtree, and the per-item controls (a heart, a bookmark) are frequently
 * unlabeled `ImageView`s with no resource-id and no content-desc. There is
 * nothing to match by identity: the ROW is the unit. This module provides the
 * three pieces that make such screens operable without guessing absolute
 * screen coordinates or probing icon-only controls on a real account:
 *
 * 1. `detectListRows` — recognize repeated isomorphic sibling subtrees (three
 *    or more children of one parent, same class, near-equal height), each with
 *    index, pixel frame, and an aggregated label.
 * 2. `parseCountsFromLabel` — parse the counters out of that aggregated label
 *    generically: a number followed by a classifier token (中文/English alike).
 *    No app vocabulary is hardcoded; only numeric units (万/亿/k/m/w) are
 *    understood as multipliers.
 * 3. `planRowTap` + `verifyCountChange` — operate at a RELATIVE position
 *    inside row N, then confirm the action by the target counter moving the
 *    expected ±1 — the only reliable confirmation a list app offers.
 *
 * Everything here is pure (no device, no adb) so the smoke can drive it with
 * an XML fixture. tool-list-rows.ts wires it to the dump and adds the
 * real-device safety gates.
 * @module @zseven-w/dsh-android/list-rows
 */
import { type UiBounds, type UiTreeNode } from './uitree.js';
/** One counter parsed out of an aggregated row label. */
export interface RowCount {
    /** The classifier token exactly as it appears (e.g. "回复", "replies"). */
    key: string;
    /** The parsed numeric value (multipliers 万/亿/k/m/w applied). */
    value: number;
}
/** One detected list row. */
export interface ListRow {
    /** 0-based order among the visible rows, top-to-bottom (then left-right). */
    index: number;
    /** Short class name the row was recognized by (e.g. `LinearLayout`). */
    type: string;
    /** Frame in display pixels. */
    frame: UiBounds;
    /**
     * Aggregated label: every DISTINCT text / content-desc inside the row
     * subtree, in document order, joined with spaces.
     */
    label?: string;
    /** Counters parsed from the label, in order of appearance. */
    counts: RowCount[];
    /** Shape-group id: rows sharing a group are isomorphic siblings. */
    group?: number;
}
/** Detected rows plus diagnostics for the tool output. */
export interface DetectRowsResult {
    rows: ListRow[];
    /** Number of distinct repeated sibling groups that produced rows. */
    repeatedGroups: number;
    /** Row candidates dropped because they lie entirely off-screen. */
    omittedOffscreen: number;
}
/**
 * Minimum siblings that make a run "repeated". Three, not the iOS twin's two:
 * Android has no Cell type to key off, so the repetition IS the only evidence
 * that a container holds list items rather than a two-column header.
 */
export declare const MIN_REPEATED_ROWS = 3;
/** Normalize a count key for comparison: lowercase Latin, collapse spaces. */
export declare function normalizeCountKey(key: string): string;
/**
 * Parse the counters out of an aggregated label: a number followed by a
 * classifier token, in 中文 or English ("57 回复。18 喜欢。592 次查看" →
 * 回复:57, 喜欢:18, 次查看:592; "57 replies · 18 likes · 592 views" → the same
 * shape). Purely generic: the classifier is whatever non-numeric token follows
 * the number, and only numeric units (万/亿/k/m/w) are multiplied in. Keys
 * round-trip: pass a key exactly as returned to `verifyCountChange`.
 */
export declare function parseCountsFromLabel(label: string): RowCount[];
/** Find a counter by key (normalized comparison, as it round-trips). */
export declare function rowCountFor(row: ListRow, key: string): number | undefined;
/**
 * Aggregate a row's label: every DISTINCT `text` and `content-desc` inside the
 * subtree, in document order, space-joined. A row's own node almost never
 * carries text on Android — the strings live in its TextView descendants — so
 * this walk IS the label.
 */
export declare function aggregateRowLabel(node: UiTreeNode): string | undefined;
export interface DetectRowsOptions {
    /** Screen bounds in pixels (off-screen candidates are dropped + counted). */
    bounds: {
        width: number;
        height: number;
    };
    /** Minimum siblings a run needs to count as "repeated" (default 3). */
    minRepeatedRows?: number;
}
/**
 * Detect the visible rows of a list/feed screen.
 *
 * A candidate run is three-or-more children of ONE parent that share a class
 * and a near-equal height, where at least one member carries a label (text or
 * content-desc anywhere in its subtree) — that label is the evidence the run
 * holds content rather than layout scaffolding. Nested runs collapse to the
 * OUTERMOST one: when a candidate strictly contains another, the inner is
 * dropped, so a `RecyclerView` whose rows each hold a repeated chip strip
 * still reports the rows and not the chips.
 *
 * Rows come back top-to-bottom (then left-to-right) with a 0-based index, the
 * aggregated label, the parsed counters, and a group id shared by isomorphic
 * siblings. uiautomator keeps recycled/scrolled-out views in the dump with
 * their real coordinates, so candidates entirely outside the screen are
 * dropped and counted as `omittedOffscreen`.
 */
export declare function detectListRows(roots: readonly UiTreeNode[], options: DetectRowsOptions): DetectRowsResult;
/** A row-tap plan: absolute tap point plus the relative fractions it came from. */
export interface RowTapPlan {
    row: ListRow;
    /** Relative position inside the row frame (0..1). */
    inRow: {
        x: number;
        y: number;
    };
    /** Absolute tap point in display pixels. */
    tap: {
        x: number;
        y: number;
    };
}
/**
 * Plan a tap at a RELATIVE position inside row `index` (from a FRESH row
 * detection). Safety by construction: the row is located in the current screen
 * state, its frame must be on-screen, and an out-of-range index FAILS — it
 * never clamps to the last row, because a clamp would silently tap a different
 * item than the model asked for.
 */
export declare function planRowTap(rows: readonly ListRow[], index: number, fractionX: number, fractionY: number, bounds: {
    width: number;
    height: number;
}): RowTapPlan;
/**
 * The probe-guard: before a row tap may carry a count-change expectation, the
 * row's parsed counters MUST contain the target key. A missing key means the
 * tap target cannot be identified — the call refuses BEFORE any tap instead of
 * "tapping to see what happens" on a real account.
 */
export declare function requireCountKey(row: ListRow, key: string): number;
/** Outcome of a count-change verification after a row action. */
export interface CountCheckResult {
    /** The expected counter key (normalized). */
    key: string;
    /** The expected delta (+1 or -1). */
    delta: 1 | -1;
    /** Value parsed before the action (absent = key was missing). */
    before?: number;
    /** Value parsed after the action (absent = key missing on re-read). */
    after?: number;
    /** True when after - before equals delta exactly. */
    verified: boolean;
    /** True when the counter moved AT ALL (even in the wrong direction). */
    changed: boolean;
    /** Why the check could not be a plain verified=true. */
    reason?: string;
}
/** Acceptable deltas: exactly ±1 (a single toggle on a real account, nothing else). */
export declare function sanitizeCountDelta(delta: number): 1 | -1;
/** True when the re-read row plausibly still IS the row that was tapped: its
 * frame stayed put (a scrolled list or a pushed screen means the counters
 * cannot be compared). */
export declare function rowsStayedPut(before: ListRow, after: ListRow): boolean;
/**
 * Compare the target counter between the before- and after- snapshots of the
 * same row. `verified` is true ONLY when both parses found the key and the
 * value moved exactly by `delta`. Everything else is reported as a reason,
 * never guessed: a missing before-key, a missing after-key (the label
 * changed), a moved row, or a counter that changed by the wrong amount.
 */
export declare function verifyCountChange(before: ListRow, after: ListRow, key: string, delta: 1 | -1): CountCheckResult;
