/**
 * DSH-styled dropdown for the device panel header, replacing the native
 * `<select>`s (whose popup ignores the app theme). Modeled on dsh-crew's
 * CustomSelect (trigger button + portal-mounted fixed menu that flips up near
 * the viewport bottom, outside-click / Escape close, ✓ on the selected row)
 * but restyled onto the `--dsw-alias-*` tokens and extended with the grouped
 * options the device picker needs (kind groups with a heading icon, a
 * disabled AVD hint group, ● markers).
 *
 * Split for the static smoke like the panel's other pieces:
 * `AndroidSelectMenu` is pure presentation (SSR-able — `createPortal` renders
 * nothing under `renderToString`, so the smoke renders the menu directly),
 * `AndroidSelect` binds trigger + portal + dismissal behavior.
 * @module @zseven-w/dsh-android/client/android-select
 */
import type { CSSProperties, ReactNode } from 'react';
/**
 * State dot rendered before an option's label. Both tones share ONE hue:
 * green means "this device is online". `active` is filled + glowing (it is
 * the one on screen, matching the panel's ● 实时 readout); `idle` is a hollow
 * ring (online, just not displayed). Options without a tone render no dot,
 * which is what an offline/unauthorized device looks like.
 */
export type AndroidSelectMarkerTone = 'active' | 'idle';
/** The dot palette — literal state colors, exactly like the live indicator. */
export declare const ANDROID_SELECT_MARKER_COLORS: Record<AndroidSelectMarkerTone, string>;
export interface AndroidSelectOption {
    value: string;
    label: string;
    /** State dot before the label (omit for no dot). */
    markerTone?: AndroidSelectMarkerTone;
    disabled?: boolean;
    ariaLabel?: string;
    title?: string;
    /** Extra data-* attributes for the option row (smoke/a11y hooks). */
    dataAttrs?: Record<string, string>;
}
export interface AndroidSelectGroup {
    id: string;
    /** Group heading (omit for a flat, headingless group). */
    label?: string;
    /** Small icon rendered before the heading — the device-kind glyph. */
    icon?: ReactNode;
    /** Disabled groups render their heading + rows muted and unpickable. */
    disabled?: boolean;
    options: AndroidSelectOption[];
    /** Extra data-* attributes for the group container. */
    dataAttrs?: Record<string, string>;
}
/** Token recipe shared by both dropdowns. Exported for the smoke. */
export declare const ANDROID_SELECT_STYLES: Record<string, CSSProperties>;
/** The selected/hover row fills (the light-theme layer ramp is invisible, so
 * the semantic interactive tokens are the only fills that read in BOTH). */
export declare const ANDROID_SELECT_ACTIVE_BG = "var(--dsw-alias-interactive-bg-active)";
export declare const ANDROID_SELECT_HOVER_BG = "var(--dsw-alias-interactive-bg-hover)";
export interface AndroidSelectMenuProps {
    groups: readonly AndroidSelectGroup[];
    value: string;
    onPick: (value: string) => void;
    /** Fixed-position geometry from the trigger (absent in SSR renders). */
    placement?: {
        left: number;
        top?: number;
        bottom?: number;
        minWidth: number;
    };
    ariaLabel?: string;
}
/** Pure menu rendering (listbox pattern); hover state is presentational. */
export declare function AndroidSelectMenu({ groups, value, onPick, placement, ariaLabel }: AndroidSelectMenuProps): React.JSX.Element;
export interface AndroidSelectProps {
    value: string;
    groups: readonly AndroidSelectGroup[];
    onChange: (value: string) => void;
    ariaLabel: string;
    disabled?: boolean;
    /** Fires when the menu opens — the device picker's list-refresh hook. */
    onOpen?: () => void;
    /** Extra style merged onto the trigger (width/flex tuning per call site). */
    triggerStyle?: CSSProperties;
    /** Extra data-* attributes for the trigger button (smoke hooks). */
    dataAttrs?: Record<string, string>;
}
export declare function AndroidSelect({ value, groups, onChange, ariaLabel, disabled, onOpen, triggerStyle, dataAttrs, }: AndroidSelectProps): React.JSX.Element;
