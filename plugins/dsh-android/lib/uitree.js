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
/** Compact tree output cap: past this the deepest levels are pruned. */
export const UI_TREE_CAP_BYTES = 40 * 1024;
/** Guidance appended when the 40 KB cap pruned the deepest levels. */
export const UI_TREE_TRUNCATED_HINT = 'The tree exceeded the 40 KB output cap and its deepest levels were pruned. '
    + 'Re-run with max_depth or filter to narrow the subtree.';
/** Default timeout for one `uiautomator dump` round trip. */
const DUMP_TIMEOUT_MS = 60_000;
/** A dump of a busy list screen measures ~500 KB; 8 MB is slack, not a target. */
const DUMP_MAX_BUFFER = 8 * 1024 * 1024;
const NAMED_ENTITIES = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: '\'',
};
/**
 * Decode the five XML entities plus decimal/hex character references. An
 * unknown or malformed reference is left verbatim rather than dropped — a
 * literal `&` in a label must survive the round trip.
 */
export function decodeXmlEntities(value) {
    if (!value.includes('&'))
        return value;
    return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, body) => {
        if (body.startsWith('#x') || body.startsWith('#X')) {
            const code = Number.parseInt(body.slice(2), 16);
            return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
        }
        if (body.startsWith('#')) {
            const code = Number.parseInt(body.slice(1), 10);
            return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
        }
        return NAMED_ENTITIES[body] ?? match;
    });
}
function isSpace(char) {
    return char === ' ' || char === '\t' || char === '\n' || char === '\r';
}
/**
 * Scan one start tag beginning at `start` (the character after `<`). The scan
 * is quote-aware: `>` inside an attribute value never ends the tag.
 */
function scanStartTag(source, start) {
    const length = source.length;
    let index = start;
    while (index < length && !isSpace(source[index]) && source[index] !== '/' && source[index] !== '>')
        index += 1;
    const name = source.slice(start, index);
    const attributes = {};
    let selfClosing = false;
    for (;;) {
        while (index < length && isSpace(source[index]))
            index += 1;
        if (index >= length)
            return { name, attributes, selfClosing, next: -1 };
        const char = source[index];
        if (char === '/') {
            selfClosing = true;
            index += 1;
            continue;
        }
        if (char === '>')
            return { name, attributes, selfClosing, next: index + 1 };
        const nameStart = index;
        while (index < length
            && !isSpace(source[index])
            && source[index] !== '='
            && source[index] !== '/'
            && source[index] !== '>')
            index += 1;
        const attributeName = source.slice(nameStart, index);
        while (index < length && isSpace(source[index]))
            index += 1;
        let raw = '';
        if (source[index] === '=') {
            index += 1;
            while (index < length && isSpace(source[index]))
                index += 1;
            const quote = source[index];
            if (quote === '"' || quote === '\'') {
                index += 1;
                const valueStart = index;
                while (index < length && source[index] !== quote)
                    index += 1;
                raw = source.slice(valueStart, index);
                index += 1;
            }
            else {
                const valueStart = index;
                while (index < length && !isSpace(source[index]) && source[index] !== '>')
                    index += 1;
                raw = source.slice(valueStart, index);
            }
        }
        if (attributeName !== '')
            attributes[attributeName] = decodeXmlEntities(raw);
        // A degenerate attribute name (nothing consumed) would spin forever.
        if (attributeName === '' && raw === '')
            index += 1;
    }
}
/**
 * Parse an attribute-only XML document into its element forest. Prologs,
 * comments, doctypes and CDATA are skipped; character data between elements is
 * ignored (uiautomator emits none). Mismatched close tags unwind to the
 * nearest matching ancestor instead of throwing — a truncated dump still
 * yields the part that arrived.
 */
export function parseXmlElements(source) {
    const roots = [];
    const stack = [];
    const length = source.length;
    let index = 0;
    while (index < length) {
        const open = source.indexOf('<', index);
        if (open < 0)
            break;
        index = open + 1;
        if (index >= length)
            break;
        if (source.startsWith('!--', index)) {
            const end = source.indexOf('-->', index);
            index = end < 0 ? length : end + 3;
            continue;
        }
        if (source.startsWith('![CDATA[', index)) {
            const end = source.indexOf(']]>', index);
            index = end < 0 ? length : end + 3;
            continue;
        }
        if (source[index] === '?' || source[index] === '!') {
            const end = source.indexOf('>', index);
            index = end < 0 ? length : end + 1;
            continue;
        }
        if (source[index] === '/') {
            const end = source.indexOf('>', index);
            if (end < 0)
                break;
            const name = source.slice(index + 1, end).trim();
            for (let depth = stack.length - 1; depth >= 0; depth -= 1) {
                if (stack[depth].name === name) {
                    stack.length = depth;
                    break;
                }
            }
            index = end + 1;
            continue;
        }
        const tag = scanStartTag(source, index);
        if (tag.next < 0)
            break;
        index = tag.next;
        if (tag.name === '')
            continue;
        const element = { name: tag.name, attributes: tag.attributes, children: [] };
        const parent = stack[stack.length - 1];
        if (parent === undefined)
            roots.push(element);
        else
            parent.children.push(element);
        if (!tag.selfClosing)
            stack.push(element);
    }
    return roots;
}
// ── uiautomator hierarchy → UiTreeNode ───────────────────────────────────────
const BOUNDS_PATTERN = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/;
/** Parse `bounds="[l,t][r,b]"` into an origin+size box; unparseable → undefined. */
export function parseBounds(raw) {
    if (raw === undefined)
        return undefined;
    const match = BOUNDS_PATTERN.exec(raw.trim());
    if (match === null)
        return undefined;
    const left = Number(match[1]);
    const top = Number(match[2]);
    const right = Number(match[3]);
    const bottom = Number(match[4]);
    if (![left, top, right, bottom].every(Number.isFinite))
        return undefined;
    return { x: left, y: top, w: right - left, h: bottom - top };
}
/** `android.widget.FrameLayout` → `FrameLayout`; empty class → `Node`. */
export function classTail(className) {
    const trimmed = (className ?? '').trim();
    if (trimmed === '')
        return 'Node';
    const tail = trimmed.slice(trimmed.lastIndexOf('.') + 1);
    return tail === '' ? trimmed : tail;
}
function attributeText(attributes, key) {
    const value = attributes[key];
    if (value === undefined)
        return undefined;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : value;
}
function isTrue(attributes, key) {
    return attributes[key] === 'true';
}
function toUiTreeNode(element) {
    const attributes = element.attributes;
    const node = {
        type: classTail(attributes.class),
        bounds: parseBounds(attributes.bounds) ?? { x: 0, y: 0, w: 0, h: 0 },
        children: [],
    };
    const text = attributeText(attributes, 'text');
    if (text !== undefined)
        node.text = text;
    const contentDesc = attributeText(attributes, 'content-desc');
    if (contentDesc !== undefined)
        node.contentDesc = contentDesc;
    const resourceId = attributeText(attributes, 'resource-id');
    if (resourceId !== undefined)
        node.resourceId = resourceId;
    // Interesting state only: absent means enabled / not focused / not
    // clickable / not scrollable (see the module header).
    if (attributes.enabled === 'false')
        node.enabled = false;
    if (isTrue(attributes, 'focused'))
        node.focused = true;
    if (isTrue(attributes, 'clickable'))
        node.clickable = true;
    if (isTrue(attributes, 'scrollable'))
        node.scrollable = true;
    for (const child of element.children) {
        if (child.name === 'node')
            node.children.push(toUiTreeNode(child));
    }
    return node;
}
/**
 * Convert one uiautomator XML document into the compact node forest. The
 * `<hierarchy>` wrapper is unwrapped (its `node` children are the window
 * roots); a dump without it falls back to any top-level `node` elements so a
 * hand-trimmed fixture still parses.
 */
export function parseUiTree(xml) {
    const elements = parseXmlElements(xml);
    const hierarchy = elements.find(element => element.name === 'hierarchy');
    const source = hierarchy?.children ?? elements;
    const roots = source.filter(element => element.name === 'node').map(toUiTreeNode);
    const rotationRaw = hierarchy?.attributes.rotation;
    const rotation = rotationRaw === undefined ? undefined : Number(rotationRaw);
    return {
        roots,
        ...(rotation !== undefined && Number.isInteger(rotation) ? { rotation } : {}),
    };
}
/**
 * Strip everything around the hierarchy document. `uiautomator dump /dev/tty`
 * writes the XML and then its own confirmation line ("UI hierchary dumped to:
 * /dev/tty" — the typo is upstream's) onto the SAME stream, and a tty may
 * translate `\n` into `\r\n` on the way out.
 */
export function extractHierarchyXml(raw) {
    const text = raw.replace(/\r\n/g, '\n');
    const end = text.lastIndexOf('</hierarchy>');
    if (end >= 0) {
        const start = text.indexOf('<');
        return text.slice(start < 0 ? 0 : start, end + '</hierarchy>'.length);
    }
    // A self-closed or empty hierarchy still counts as a valid (if useless) dump.
    const empty = /<hierarchy\b[^>]*\/>/.exec(text);
    if (empty !== null)
        return empty[0];
    const snippet = text.trim().slice(0, 200);
    throw new Error('the uiautomator dump did not contain a <hierarchy> document'
        + `${snippet === '' ? ' (the device produced no output)' : `: ${snippet}`}`);
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
export async function dumpUiTreeXml(toolchain, serial, options = {}) {
    const timeoutMs = options.timeoutMs ?? DUMP_TIMEOUT_MS;
    const execOptions = { timeoutMs, maxBuffer: DUMP_MAX_BUFFER };
    let primaryFailure;
    // "could not get idle state" earns exactly one retry after a short pause:
    // a transient animation (screen-on ripple, app launch) settles in well
    // under a second, while a CONTINUOUSLY animating foreground (a web page
    // with a spinner is the classic case) will fail again — and then the
    // error below routes the caller to OCR instead of a retry loop.
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const buffer = await toolchain.execOut(serial, ['uiautomator', 'dump', '/dev/tty'], execOptions);
            return extractHierarchyXml(buffer.toString('utf8'));
        }
        catch (error) {
            primaryFailure = error instanceof Error ? error.message : String(error);
            if (attempt === 0 && /could not get idle state/i.test(primaryFailure)) {
                await new Promise(resolve => setTimeout(resolve, 800));
                continue;
            }
            break;
        }
    }
    if (primaryFailure !== undefined && /could not get idle state/i.test(primaryFailure)) {
        // The /sdcard fallback runs the SAME dump against the same never-idle
        // foreground; paying its ~10 s only to fail identically helps nobody.
        throw new Error(`uiautomator could not dump the window hierarchy of ${serial} (${primaryFailure}). `
            + 'The foreground app is continuously animating (web pages in a browser are the classic case), '
            + 'so uiautomator can never reach its idle state — do not retry this tool; read the screen with '
            + 'android_find_text and tap with android_tap_text instead (OCR reads pixels and needs no idle).');
    }
    const remotePath = '/sdcard/window_dump.xml';
    try {
        const notice = await toolchain.shell(serial, ['uiautomator', 'dump', remotePath], execOptions);
        const buffer = await toolchain.execOut(serial, ['cat', remotePath], execOptions);
        const xml = extractHierarchyXml(buffer.toString('utf8'));
        await toolchain.shell(serial, ['rm', '-f', remotePath], execOptions).catch(() => { });
        if (xml.trim() === '')
            throw new Error(notice.trim());
        return xml;
    }
    catch (error) {
        await toolchain.shell(serial, ['rm', '-f', remotePath], execOptions).catch(() => { });
        const fallbackFailure = error instanceof Error ? error.message : String(error);
        const idleStarved = /could not get idle state/i.test(`${primaryFailure} ${fallbackFailure}`);
        throw new Error(`uiautomator could not dump the window hierarchy of ${serial} `
            + `(exec-out /dev/tty: ${primaryFailure}; ${remotePath} fallback: ${fallbackFailure}). `
            + (idleStarved
                // Already retried once above: a foreground that STILL never idles is
                // continuously animating, and no number of dump retries will land.
                ? 'The foreground app is continuously animating (web pages in a browser are the classic case), '
                    + 'so uiautomator can never reach its idle state — do not retry this tool; read the screen with '
                    + 'android_find_text and tap with android_tap_text instead (OCR reads pixels and needs no idle).'
                : 'uiautomator needs the screen ON and an idle window — wake the device (android_interact with '
                    + 'button "wake"), wait for animations to settle, and retry; if it keeps failing the screen is '
                    + 'likely secure (FLAG_SECURE) and only android_find_text can read it.'));
    }
}
/** Dump and parse in one step. */
export async function readUiTree(toolchain, serial, options = {}) {
    return parseUiTree(await dumpUiTreeXml(toolchain, serial, options));
}
// ── tree shaping ─────────────────────────────────────────────────────────────
/** Screen bounds in display pixels, taken from the widest/tallest root. */
export function screenBoundsOf(roots) {
    let width = 0;
    let height = 0;
    for (const root of roots) {
        width = Math.max(width, root.bounds.x + root.bounds.w);
        height = Math.max(height, root.bounds.y + root.bounds.h);
    }
    if (width <= 0 || height <= 0) {
        const fallback = roots.length > 0 ? roots[0].bounds : { w: 0, h: 0 };
        width = fallback.w;
        height = fallback.h;
    }
    return { width, height };
}
/**
 * True when `bounds` lies ENTIRELY outside the screen. uiautomator keeps
 * scrolled-out rows in the dump with their real (off-screen) coordinates and
 * exposes no visibility flag, so geometry is the only signal — the same
 * predicate the AXe path used in dsh-ios.
 */
export function isOffscreenBounds(bounds, screen) {
    if (screen.width <= 0 || screen.height <= 0)
        return false;
    // A zero-size box can never be tapped, so it counts as off-screen too.
    return bounds.x + bounds.w <= 0
        || bounds.y + bounds.h <= 0
        || bounds.x >= screen.width
        || bounds.y >= screen.height;
}
/** Case-insensitive substring match over text, content-desc, resource-id and type. */
export function nodeMatchesFilter(node, needle) {
    const haystacks = [node.type, node.text, node.contentDesc, node.resourceId];
    return haystacks.some(value => value !== undefined && value.toLowerCase().includes(needle));
}
function copyNode(node) {
    const copy = { type: node.type, bounds: { ...node.bounds }, children: [] };
    if (node.text !== undefined)
        copy.text = node.text;
    if (node.contentDesc !== undefined)
        copy.contentDesc = node.contentDesc;
    if (node.resourceId !== undefined)
        copy.resourceId = node.resourceId;
    if (node.enabled !== undefined)
        copy.enabled = node.enabled;
    if (node.focused !== undefined)
        copy.focused = node.focused;
    if (node.clickable !== undefined)
        copy.clickable = node.clickable;
    if (node.scrollable !== undefined)
        copy.scrollable = node.scrollable;
    return copy;
}
/**
 * Build the output tree: an optional case-insensitive substring filter (a node
 * survives when it or any descendant matches — ancestors of matches are kept
 * so the tree stays connected) and an optional nesting depth cap.
 */
export function buildCompactTree(roots, maxDepth, filter) {
    const needle = filter !== undefined && filter.trim() !== '' ? filter.trim().toLowerCase() : undefined;
    let count = 0;
    const walk = (node, depth) => {
        const selfMatches = needle === undefined || nodeMatchesFilter(node, needle);
        const children = [];
        if (maxDepth === undefined || depth < maxDepth) {
            for (const child of node.children) {
                const compact = walk(child, depth + 1);
                if (compact !== undefined)
                    children.push(compact);
            }
        }
        if (!selfMatches && children.length === 0)
            return undefined;
        const copy = copyNode(node);
        copy.children = children;
        count += 1;
        return copy;
    };
    const tree = [];
    for (const root of roots) {
        const compact = walk(root, 0);
        if (compact !== undefined)
            tree.push(compact);
    }
    return { tree, count };
}
/** Count nodes of an already-built compact tree (the node itself included). */
export function countNodes(node) {
    return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}
function treeDepth(nodes) {
    let depth = 0;
    for (const node of nodes) {
        if (node.children.length > 0)
            depth = Math.max(depth, 1 + treeDepth(node.children));
    }
    return depth;
}
function pruneDeepestLevel(nodes) {
    const depth = treeDepth(nodes);
    if (depth === 0)
        return;
    const pruneAt = (list, level) => {
        for (const node of list) {
            if (level === depth - 1)
                node.children = [];
            else
                pruneAt(node.children, level + 1);
        }
    };
    pruneAt(nodes, 0);
}
function treeBytes(nodes) {
    return Buffer.byteLength(JSON.stringify(nodes), 'utf8');
}
/**
 * Fit a compact tree under `capBytes` by pruning the deepest levels first —
 * the same strategy the `max_depth` hint offers interactively. Mutates the
 * nodes it is handed (they are already the tool's private copies).
 */
export function capTreeToBytes(tree, capBytes = UI_TREE_CAP_BYTES) {
    let truncated = treeBytes(tree) > capBytes;
    while (treeBytes(tree) > capBytes && treeDepth(tree) > 0) {
        pruneDeepestLevel(tree);
    }
    if (!truncated)
        truncated = treeBytes(tree) > capBytes;
    return { tree, truncated };
}
/** True when the tree carries at least one labeled node (text or content-desc). */
export function hasLabeledNode(nodes) {
    for (const node of nodes) {
        if (node.text !== undefined || node.contentDesc !== undefined)
            return true;
        if (hasLabeledNode(node.children))
            return true;
    }
    return false;
}
/** Depth-first flatten, roots first. */
export function flattenNodes(roots) {
    const flat = [];
    const walk = (node, depth) => {
        flat.push({ ...node, depth });
        for (const child of node.children)
            walk(child, depth + 1);
    };
    for (const root of roots)
        walk(root, 0);
    return flat;
}
/** Tolerance (pixels) for containment checks — rounding, not layout, slack. */
const BOUNDS_EPSILON = 1;
/** True when `outer` (approximately) contains `inner`. */
export function containsBounds(outer, inner) {
    return outer.x <= inner.x + BOUNDS_EPSILON
        && outer.y <= inner.y + BOUNDS_EPSILON
        && outer.x + outer.w >= inner.x + inner.w - BOUNDS_EPSILON
        && outer.y + outer.h >= inner.y + inner.h - BOUNDS_EPSILON;
}
/** True when two boxes are the same box (mutual containment). */
export function sameBounds(a, b) {
    return containsBounds(a, b) && containsBounds(b, a);
}
/**
 * Widget classes that ARE controls even when the platform did not mark them
 * clickable (a disabled Button reports clickable="false"). `clickable=true`
 * remains the primary signal; this set only rescues the chain-folding step.
 */
const CONTROL_TYPES = new Set([
    'Button', 'ImageButton', 'CompoundButton', 'CheckBox', 'CheckedTextView',
    'RadioButton', 'Switch', 'SwitchCompat', 'ToggleButton', 'MaterialButton',
    'EditText', 'AutoCompleteTextView', 'SearchView', 'SeekBar', 'RatingBar',
    'Spinner', 'TabWidget', 'ActionMenuItemView', 'MenuItem', 'Chip',
    'FloatingActionButton', 'BottomNavigationItemView', 'NavigationMenuItemView',
]);
function isControl(node) {
    return node.clickable === true || CONTROL_TYPES.has(node.type);
}
function describeCandidate(node, index) {
    const text = node.text === undefined ? '' : ` text=${JSON.stringify(node.text)}`;
    const desc = node.contentDesc === undefined ? '' : ` content-desc=${JSON.stringify(node.contentDesc)}`;
    const id = node.resourceId === undefined ? '' : ` resource-id=${JSON.stringify(node.resourceId)}`;
    // The false flags are the ones that explain a skip; true is the normal
    // state and stays implicit.
    const flags = node.enabled === false ? ' enabled=false' : '';
    const bounds = `bounds={x:${node.bounds.x},y:${node.bounds.y},w:${node.bounds.w},h:${node.bounds.h}}`;
    return `${index}) type=${node.type}${text}${desc}${id}${flags} ${bounds}`;
}
/** Actionable refusal when every selector match is off-screen or disabled. */
function tapGateFailure(tool, representatives, screen, wanted, allowOffscreen) {
    const offscreen = representatives.filter(node => isOffscreenBounds(node.bounds, screen));
    const disabled = representatives.filter(node => node.enabled === false);
    const hint = allowOffscreen ? ' (allow_offscreen=true bypasses only the off-screen check — disabled stays refused)' : '';
    if (offscreen.length > 0 && disabled.length > 0) {
        throw new Error(`${tool}: ${wanted} matched ${representatives.length} node(s) that are off-screen or disabled`
            + ` — scroll the off-screen ones into view first and enable the disabled ones${hint}`);
    }
    if (offscreen.length > 0) {
        const noun = representatives.length === 1
            ? 'matched an off-screen node'
            : `matched ${representatives.length} off-screen nodes`;
        throw new Error(`${tool}: ${wanted} ${noun} — scroll it into view first (android_interact with a scroll action), `
            + 'then re-run android_ui_tree so the fresh dump re-locates it'
            + `; pass allow_offscreen=true to tap the recorded coordinates anyway${hint}`);
    }
    const noun = representatives.length === 1 ? 'matched a disabled node' : `matched ${representatives.length} disabled nodes`;
    throw new Error(`${tool}: ${wanted} ${noun} — the control is disabled, so a tap would do nothing; enable it first${hint}`);
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
export function resolveTapTarget(roots, selector, options = {}) {
    const tool = options.tool ?? 'android_tap_element';
    const identifier = selector.identifier !== undefined && selector.identifier.trim() !== ''
        ? selector.identifier.trim()
        : undefined;
    const label = selector.label !== undefined && selector.label.trim() !== '' ? selector.label.trim() : undefined;
    if (identifier === undefined && label === undefined) {
        throw new Error(`${tool} requires an element selector: identifier (the resource-id) and/or label `
            + '(the text or content-desc). Run android_ui_tree to see what the screen exposes.');
    }
    const flat = flattenNodes(roots);
    const matchesValue = (actual, wantedValue, mode) => {
        if (actual === undefined)
            return false;
        return mode === 'exact' ? actual === wantedValue : actual.toLowerCase().includes(wantedValue.toLowerCase());
    };
    const matchesNode = (node, mode) => {
        if (identifier !== undefined && !matchesValue(node.resourceId, identifier, mode))
            return false;
        if (label !== undefined
            && !matchesValue(node.text, label, mode)
            && !matchesValue(node.contentDesc, label, mode))
            return false;
        return true;
    };
    let candidates = flat.filter(node => matchesNode(node, 'exact'));
    let matchedBy = 'exact';
    if (candidates.length === 0) {
        candidates = flat.filter(node => matchesNode(node, 'contains'));
        matchedBy = 'contains';
    }
    const wantedParts = [];
    if (identifier !== undefined)
        wantedParts.push(`identifier ${JSON.stringify(identifier)}`);
    if (label !== undefined)
        wantedParts.push(`label ${JSON.stringify(label)}`);
    const wanted = wantedParts.join(' and ');
    if (candidates.length === 0) {
        throw new Error(`${tool}: no node matches ${wanted} on the current screen — run android_ui_tree to inspect what is `
            + 'actually there, or android_find_text to OCR labels the view hierarchy does not carry '
            + '(Compose/Flutter/WebView/game canvases often expose none).');
    }
    // Drop exact box duplicates of the same class (a wrapper listed twice).
    const unique = candidates.filter((node, index) => !candidates
        .slice(0, index)
        .some(other => other.type === node.type && sameBounds(other.bounds, node.bounds)));
    // Group containment chains: an ancestor that mirrors its child's text is
    // the same row, not an ambiguity.
    const chains = [];
    for (const node of unique) {
        const chain = chains.find(group => group.some(other => !sameBounds(node.bounds, other.bounds)
            && (containsBounds(node.bounds, other.bounds) || containsBounds(other.bounds, node.bounds))));
        if (chain === undefined)
            chains.push([node]);
        else
            chain.push(node);
    }
    const representatives = chains.map(chain => {
        const controls = chain.filter(isControl);
        if (controls.length > 0) {
            // Outermost control of the chain: not contained in another control.
            const outer = controls.find(node => !controls.some(other => other !== node && containsBounds(other.bounds, node.bounds) && !sameBounds(other.bounds, node.bounds)));
            return outer ?? controls[0];
        }
        // No control in the chain: the deepest (most specific) node it is.
        return chain.reduce((deepest, node) => (node.depth > deepest.depth ? node : deepest), chain[0]);
    });
    const screen = screenBoundsOf(roots);
    const allowOffscreen = options.allowOffscreen === true;
    const viable = representatives.filter(node => node.enabled !== false && (allowOffscreen || !isOffscreenBounds(node.bounds, screen)));
    if (viable.length === 0)
        tapGateFailure(tool, representatives, screen, wanted, allowOffscreen);
    if (viable.length > 1) {
        const skipped = representatives.length - viable.length;
        const skippedSentence = skipped > 0 ? ` (${skipped} skipped: off-screen or disabled)` : '';
        const shown = representatives.slice(0, 8);
        const more = representatives.length - shown.length;
        throw new Error(`${tool}: ${representatives.length} nodes match ${wanted}${skippedSentence} — use a more specific `
            + 'selector (an exact label, a resource-id, or android_ui_tree to disambiguate). Candidates:\n'
            + shown.map((node, index) => `  ${describeCandidate(node, index + 1)}`).join('\n')
            + (more > 0 ? `\n  …and ${more} more` : ''));
    }
    return { node: viable[0], matchedBy };
}
/** Center of a box in display pixels (integers: `input tap` takes pixels). */
export function boundsCenter(bounds) {
    return {
        x: Math.round(bounds.x + bounds.w / 2),
        y: Math.round(bounds.y + bounds.h / 2),
    };
}
