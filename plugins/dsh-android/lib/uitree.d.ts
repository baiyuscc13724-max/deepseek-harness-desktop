/**
 * uiautomator backend: dump the frontmost window's view hierarchy over plain
 * adb, parse it, and shape it into the compact node tree the semantic tools
 * reason over.
 *
 * This is the Android answer to dsh-ios's AXe/WebDriverAgent split — and it
 * is a single backend, not two: emulators and physical devices both answer
 * `adb shell uiautomator dump`, so there is no per-backend matching table,
 * no snapshot-depth ladder, and no helper binary to install (uiautomator
 * ships inside the platform). What DOES differ from iOS:
 *
 * - Coordinates are DISPLAY PIXELS, origin top-left, in the current display
 *   space (`bounds="[l,t][r,b]"`). The frame the panel streams uses the same
 *   space, so a tap only needs `pixel / screen` to reach the normalized 0..1
 *   contract of `AndroidHostController.tap` (docs/architecture.zh.md).
 * - There is no `visible` flag. Off-screen rows are detected geometrically
 *   against the hierarchy root bounds, exactly like the AXe path did.
 * - Every node reports `enabled`, and almost all of them report `true`. To
 *   keep the 40 KB output cap useful, the flags are emitted ONLY in their
 *   interesting state: `enabled` appears only when the control is DISABLED,
 *   and `focused`/`clickable`/`scrollable` only when true. Absent therefore
 *   means "enabled / not focused / not clickable / not scrollable" — never
 *   "unknown".
 *
 * The XML parser below is hand-written on purpose: the plugin ships with no
 * third-party runtime dependency, and uiautomator's output is a tiny, strictly
 * attribute-only dialect (no text content, no namespaces, no DTD). It is
 * quote-aware, so an attribute value containing `>` cannot terminate a tag
 * early, and it decodes the five XML entities plus numeric character
 * references.
 * @module @zseven-w/dsh-android/uitree
 */
import type { AdbToolchain } from './adb.js';
/** Compact tree output cap: past this the deepest levels are pruned. */
export declare const UI_TREE_CAP_BYTES: number;
/** Guidance appended when the 40 KB cap pruned the deepest levels. */
export declare const UI_TREE_TRUNCATED_HINT: string;
/** Node bounds in display pixels, origin top-left. */
export interface UiBounds {
    x: number;
    y: number;
    w: number;
    h: number;
}
/**
 * One compact view node.
 *
 * Empty string attributes are omitted (uiautomator writes `text=""` on every
 * container), and the booleans follow the interesting-state rule documented
 * in the module header.
 */
export interface UiTreeNode {
    /** Trailing segment of the `class` attribute, e.g. `android.widget.Button` → `Button`. */
    type: string;
    /** `text` attribute, when non-empty. */
    text?: string;
    /** `content-desc` attribute, when non-empty. */
    contentDesc?: string;
    /** `resource-id` attribute, when non-empty. */
    resourceId?: string;
    bounds: UiBounds;
    /** Present ONLY when the control is disabled (`enabled="false"`). */
    enabled?: boolean;
    /** Present ONLY when true. */
    focused?: boolean;
    /** Present ONLY when true. */
    clickable?: boolean;
    /** Present ONLY when true. */
    scrollable?: boolean;
    children: UiTreeNode[];
}
/** One parsed XML element (attribute-only dialect: text content is dropped). */
export interface XmlElement {
    name: string;
    attributes: Record<string, string>;
    children: XmlElement[];
}
/**
 * Decode the five XML entities plus decimal/hex character references. An
 * unknown or malformed reference is left verbatim rather than dropped — a
 * literal `&` in a label must survive the round trip.
 */
export declare function decodeXmlEntities(value: string): string;
/**
 * Parse an attribute-only XML document into its element forest. Prologs,
 * comments, doctypes and CDATA are skipped; character data between elements is
 * ignored (uiautomator emits none). Mismatched close tags unwind to the
 * nearest matching ancestor instead of throwing — a truncated dump still
 * yields the part that arrived.
 */
export declare function parseXmlElements(source: string): XmlElement[];
/** Parse `bounds="[l,t][r,b]"` into an origin+size box; unparseable → undefined. */
export declare function parseBounds(raw: string | undefined): UiBounds | undefined;
/** `android.widget.FrameLayout` → `FrameLayout`; empty class → `Node`. */
export declare function classTail(className: string | undefined): string;
/** One parsed hierarchy: the window roots plus the display rotation it reported. */
export interface ParsedUiTree {
    roots: UiTreeNode[];
    /** `hierarchy rotation` (Surface.ROTATION_0..3), when the dump carried it. */
    rotation?: number;
}
/**
 * Convert one uiautomator XML document into the compact node forest. The
 * `<hierarchy>` wrapper is unwrapped (its `node` children are the window
 * roots); a dump without it falls back to any top-level `node` elements so a
 * hand-trimmed fixture still parses.
 */
export declare function parseUiTree(xml: string): ParsedUiTree;
/**
 * Strip everything around the hierarchy document. `uiautomator dump /dev/tty`
 * writes the XML and then its own confirmation line ("UI hierchary dumped to:
 * /dev/tty" — the typo is upstream's) onto the SAME stream, and a tty may
 * translate `\n` into `\r\n` on the way out.
 */
export declare function extractHierarchyXml(raw: string): string;
/** Everything one dump needs from the adb toolchain (the smoke fakes this). */
export interface UiTreeToolchain {
    execOut: AdbToolchain['execOut'];
    shell: AdbToolchain['shell'];
}
/**
 * Dump the frontmost window hierarchy of `serial`.
 *
 * Primary path: `adb exec-out uiautomator dump /dev/tty` — one round trip, no
 * device-side file, and binary-safe so a CRLF-translating tty cannot corrupt
 * the payload. Some vendor images refuse `/dev/tty` (permission denied, or an
 * empty stream); the fallback writes `/sdcard/window_dump.xml`, cats it back,
 * and removes it again so nothing is left behind.
 */
export declare function dumpUiTreeXml(toolchain: UiTreeToolchain, serial: string, options?: {
    timeoutMs?: number;
}): Promise<string>;
/** Dump and parse in one step. */
export declare function readUiTree(toolchain: UiTreeToolchain, serial: string, options?: {
    timeoutMs?: number;
}): Promise<ParsedUiTree>;
/** Screen bounds in display pixels, taken from the widest/tallest root. */
export declare function screenBoundsOf(roots: readonly UiTreeNode[]): {
    width: number;
    height: number;
};
/**
 * True when `bounds` lies ENTIRELY outside the screen. uiautomator keeps
 * scrolled-out rows in the dump with their real (off-screen) coordinates and
 * exposes no visibility flag, so geometry is the only signal — the same
 * predicate the AXe path used in dsh-ios.
 */
export declare function isOffscreenBounds(bounds: UiBounds, screen: {
    width: number;
    height: number;
}): boolean;
/** Case-insensitive substring match over text, content-desc, resource-id and type. */
export declare function nodeMatchesFilter(node: UiTreeNode, needle: string): boolean;
/**
 * Build the output tree: an optional case-insensitive substring filter (a node
 * survives when it or any descendant matches — ancestors of matches are kept
 * so the tree stays connected) and an optional nesting depth cap.
 */
export declare function buildCompactTree(roots: readonly UiTreeNode[], maxDepth?: number, filter?: string): {
    tree: UiTreeNode[];
    count: number;
};
/** Count nodes of an already-built compact tree (the node itself included). */
export declare function countNodes(node: UiTreeNode): number;
/**
 * Fit a compact tree under `capBytes` by pruning the deepest levels first —
 * the same strategy the `max_depth` hint offers interactively. Mutates the
 * nodes it is handed (they are already the tool's private copies).
 */
export declare function capTreeToBytes(tree: UiTreeNode[], capBytes?: number): {
    tree: UiTreeNode[];
    truncated: boolean;
};
/** True when the tree carries at least one labeled node (text or content-desc). */
export declare function hasLabeledNode(nodes: readonly UiTreeNode[]): boolean;
/** Flattened node used for selector resolution (depth carries the specificity). */
export interface FlatUiNode extends UiTreeNode {
    depth: number;
}
/** Depth-first flatten, roots first. */
export declare function flattenNodes(roots: readonly UiTreeNode[]): FlatUiNode[];
/** True when `outer` (approximately) contains `inner`. */
export declare function containsBounds(outer: UiBounds, inner: UiBounds): boolean;
/** True when two boxes are the same box (mutual containment). */
export declare function sameBounds(a: UiBounds, b: UiBounds): boolean;
/** How a selector matched. */
export type UiMatchMode = 'exact' | 'contains';
/** One resolved tap target. */
export interface ResolvedUiTarget {
    node: FlatUiNode;
    matchedBy: UiMatchMode;
}
/** Selector fields: `identifier` is the resource-id, `label` is text OR content-desc. */
export interface UiSelector {
    identifier?: string;
    label?: string;
}
export interface ResolveTapOptions {
    /** Tap a node whose bounds lie outside the screen (default false). */
    allowOffscreen?: boolean;
    /** Tool name used in the thrown messages (default `android_tap_element`). */
    tool?: string;
}
/**
 * Resolve one node from a selector.
 *
 * `identifier` matches the resource-id; `label` matches the text OR the
 * content-desc (Android splits what iOS merged into one accessibility label,
 * so one selector field covers both). Exact (case-sensitive) equality wins;
 * otherwise case-insensitive substring. When both fields are given both must
 * match.
 *
 * Nested duplicates — a list row mirrors its text onto a child TextView, and
 * the clickable container wraps them both — collapse into ONE chain by bounds
 * containment; the chain's outermost control (clickable, or a control widget
 * class) is the tap target, falling back to the deepest, most specific node
 * when the chain contains no control at all.
 *
 * Safety gate: matches that are off-screen (bounds entirely outside the
 * screen) or disabled (`enabled="false"`) are NOT tappable. When every match
 * fails the gate the resolver throws an actionable error naming the fix;
 * `allowOffscreen` skips only the off-screen half — a disabled node always
 * refuses. Distinct nodes that all survive the gate raise an ambiguity error
 * listing up to 8 candidates with their text, id, bounds and false flags, so
 * the model can see why a candidate was skipped.
 */
export declare function resolveTapTarget(roots: readonly UiTreeNode[], selector: UiSelector, options?: ResolveTapOptions): ResolvedUiTarget;
/** Center of a box in display pixels (integers: `input tap` takes pixels). */
export declare function boundsCenter(bounds: UiBounds): {
    x: number;
    y: number;
};
