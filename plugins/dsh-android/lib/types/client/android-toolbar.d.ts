/**
 * The panel toolbar's icon cluster + segmented quick sizes.
 *
 * The stream actions are ICON buttons grouped in ONE rounded pill container.
 * The first three are the ANDROID NAVIGATION TRIAD — ◁ Back · ○ Home ·
 * □ Recents — three PEERS in the same pill as rotate/screenshot/refresh:
 * unlike dsh-ios (one Home button whose double-click opened the app
 * switcher), Android has a real Recents key, so there is NO double-click
 * gesture anywhere in this toolbar.
 *
 * The icons are inline stroke SVGs in a 16×16 viewBox (stroke `currentColor`,
 * width 1.5, round caps/joins), so the DSH theme tokens color them through
 * the button's `color` — no icon fonts, no assets, no dependencies.
 *
 * Each icon button shows a small token-styled tooltip BELOW the button on
 * hover or keyboard focus (150ms show delay, instant hide). The codebase
 * styles via inline objects (no CSS pseudo-elements), so the hover/focus
 * state is explicit React state and the tooltip is an absolutely-positioned
 * label rendered off that state. The label is the same localized string as
 * the button's `aria-label` — the tooltip is visual sugar only.
 *
 * The size quick buttons (Fit/适应 · 100% · S · M) share the same visual
 * language as ONE borderless segmented pill group: a single outer border on
 * the container, borderless text segments with a subtle hover highlight, and
 * the ACTIVE segment marked by a stronger background FILL.
 *
 * Style tokens: the hover highlight uses `--dsw-alias-interactive-bg-hover`
 * and the active fill uses `--dsw-alias-interactive-bg-active` rather than
 * the raw layer ramp — in the LIGHT theme `bg-layer-1`/`bg-layer-2` resolve
 * to the same white, so the semantic interactive tokens are the only
 * layer-ish fills that read clearly in BOTH themes.
 */
import type { CSSProperties } from 'react';
import type { AndroidCopy } from './copy.js';
/** The toolbar action ids (nav triad first, then the stream utilities). */
export type AndroidToolbarActionId = 'back' | 'home' | 'recents' | 'screenshot' | 'rotate' | 'refresh';
/** The action roster in the pill's render order. */
export declare const ANDROID_TOOLBAR_ACTION_IDS: readonly AndroidToolbarActionId[];
/** The three actions that map to `/control` `{kind:'button'}` key events. */
export declare const ANDROID_TOOLBAR_NAV_ACTIONS: readonly AndroidToolbarActionId[];
/** Localized label for one action — the button aria-label AND the tooltip. */
export declare function androidToolbarActionLabelOf(action: AndroidToolbarActionId, copy: AndroidCopy): string;
/**
 * The icon set: minimal stroke paths in a 16×16 viewBox, drawn with
 * `stroke="currentColor"` / `fill="none"` / strokeWidth 1.5 / round caps —
 * exported so the static smoke can assert the set directly.
 *
 * - back: the Android ◁ triangle;
 * - home: the Android ○ circle;
 * - recents: the Android □ square;
 * - screenshot: a camera — body outline + lens circle;
 * - rotate: rotate-cw — one 270° arc with the top-right arrowhead;
 * - refresh: refresh-cw — two mirrored 180° arcs with both arrowheads.
 */
export declare const ANDROID_TOOLBAR_ICON_PATHS: Record<AndroidToolbarActionId, readonly string[]>;
/** One inline stroke icon (16px, currentColor — the button's color token). */
export declare function AndroidToolbarIcon({ action }: {
    action: AndroidToolbarActionId;
}): React.JSX.Element;
/**
 * Toolbar pill + button + tooltip + size-segment styles over the DSH theme
 * tokens (no literal colors — the vars resolve per light/dark theme).
 * Exported so the static smoke can assert the token usage directly.
 */
export declare const ANDROID_TOOLBAR_STYLES: Record<string, CSSProperties>;
/** Tooltip show delay (nice-to-have ~150ms). */
export declare const ANDROID_TOOLBAR_TOOLTIP_DELAY_MS = 150;
/** The pure tooltip bubble (exported for the static smoke). */
export declare function AndroidToolbarTooltip({ label }: {
    label: string;
}): React.JSX.Element;
export interface AndroidToolbarIconButtonProps {
    /** Which icon to draw (also the `data-android-toolbar-action` id). */
    action: AndroidToolbarActionId;
    /** Localized aria-label AND tooltip text. */
    label: string;
    onClick?: () => void;
    /**
     * Tooltip-open override for the static smoke: when provided it wins over
     * the internal hover/focus state (absent → the button's own state).
     */
    tooltipOpen?: boolean;
}
/**
 * One toolbar action as an icon button: borderless 28px square inside the
 * pill, hover/focus highlight, and the tooltip below it. The tooltip opens
 * after the 150ms delay on mouseenter/focus and closes immediately on
 * mouseleave/blur; the button keeps its `aria-label` regardless. There is no
 * double-click affordance — every Android navigation key is its own button.
 */
export declare function AndroidToolbarIconButton({ action, label, onClick, tooltipOpen, }: AndroidToolbarIconButtonProps): React.JSX.Element;
export interface AndroidSizeQuickSegmentProps {
    /** Quick option id (fit / percent-100 / preset-S / preset-M). */
    id: string;
    /** Rendered text label (localized by the caller). */
    label: string;
    /** Full localized aria-label. */
    ariaLabel: string;
    /** title attribute (localized size-mode caption). */
    title: string;
    /** Active state mirrors the store's sizeMode (aria-pressed + fill). */
    active: boolean;
    onClick?: () => void;
}
/**
 * One size quick button as a borderless text segment of the segmented pill
 * group: hover = subtle highlight, ACTIVE = stronger background fill. The
 * active fill wins over the hover highlight so the pressed segment never
 * lightens under the cursor.
 */
export declare function AndroidSizeQuickSegment({ id, label, ariaLabel, title, active, onClick, }: AndroidSizeQuickSegmentProps): React.JSX.Element;
