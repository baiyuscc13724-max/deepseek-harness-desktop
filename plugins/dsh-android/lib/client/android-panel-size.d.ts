/**
 * Device display size modes for the panel stage.
 *
 * The stream/screenshot display inside the panel's phone frame is sized by
 * one of three modes, chosen with a compact dropdown in the panel header:
 *
 * - `fit`    (DEFAULT): the frame fills the panel's content width, so
 *   dragging the panel's resize handle scales the device with it;
 * - `percent`: 50% / 75% / 100% / 125% of the device's LOGICAL (dp) width;
 * - `preset`: quick fixed sizes — S (240px), M (320px), L (420px). The preset
 *   value is the device's SHORT-side display size, so a landscape frame
 *   scales it by the frame's width/height ratio and the device keeps its
 *   physical size across a rotation.
 *
 * NO ROTATION MATH LIVES HERE. An Android `screencap` frame already follows
 * the display rotation (a landscape app streams 2400×1080), so the "displayed"
 * box IS the natural frame box — `androidPanelFrameLayoutOf` is a plain
 * fallback-aware read of `naturalWidth/naturalHeight`, and the dsh-ios
 * `sim-orientation.ts` counter-rotation machinery has no counterpart.
 *
 * The device scale (px per dp) is DERIVED from the frame instead of being a
 * constant: Android densities vary wildly (2.0 … 3.5+) where iOS simulators
 * are always ~3×. It is taken off the frame's SHORT side (`min(w, h) / 412`)
 * because that side is the device's portrait width in either orientation —
 * using the raw width would report a 5.8× scale for a landscape frame.
 *
 * Everything here is pure (no DOM, no React state), so the dev-panel-smoke
 * script exercises the mode transitions and the width computation directly.
 */
/** Reference logical width (dp) of a mainstream phone — the scale basis. */
export declare const ANDROID_PANEL_FALLBACK_LOGICAL_WIDTH = 412;
/** Reference logical height (dp) for the frame's base 412×915 shape. */
export declare const ANDROID_PANEL_FALLBACK_LOGICAL_HEIGHT = 915;
/** Density used until a frame reports its natural size (412dp → 1080px). */
export declare const ANDROID_PANEL_DEVICE_SCALE_FALLBACK = 2.625;
/** The size-mode state persisted in the panel store. */
export type AndroidPanelSizeMode = {
    kind: 'fit';
} | {
    kind: 'percent';
    value: number;
} | {
    kind: 'preset';
    width: number;
};
/** Shared default (stable identity — the store and panels all use it). */
export declare const ANDROID_PANEL_SIZE_MODE_FIT: AndroidPanelSizeMode;
/** The zoom percentages offered by the percent mode. */
export declare const ANDROID_PANEL_PERCENT_OPTIONS: readonly [50, 75, 100, 125];
export interface AndroidPanelPresetOption {
    id: 'S' | 'M' | 'L';
    width: number;
    labelEn: string;
    labelZh: string;
}
/**
 * The quick fixed widths of the preset mode. Each preset is the device's
 * SHORT-side display size — the labels keep the raw px because the number
 * refers to that short side, not the frame width in every orientation.
 */
export declare const ANDROID_PANEL_PRESET_OPTIONS: readonly AndroidPanelPresetOption[];
export interface AndroidPanelSizeOption {
    id: string;
    mode: AndroidPanelSizeMode;
    labelEn: string;
    labelZh: string;
}
/** The dropdown's option roster (fit first, then percent, then presets). */
export declare const ANDROID_PANEL_SIZE_OPTIONS: readonly AndroidPanelSizeOption[];
/** The displayed frame box: the natural frame dims, or the 412×915 fallback
 * shape at the fallback density. The frame is already display-rotated, so
 * there is nothing to swap. */
export interface AndroidFrameLayout {
    displayW: number;
    displayH: number;
}
export declare function androidPanelFrameLayoutOf(naturalWidth: number | undefined, naturalHeight: number | undefined): AndroidFrameLayout;
/**
 * The device's pixel density derived from the frame's SHORT side (px per dp).
 * Falls back to 2.625 while no natural size is known. Clamped to a sane
 * 1…6 range so a garbage frame can never collapse the percent basis.
 */
export declare function androidDeviceScaleOf(naturalWidth: number | undefined, naturalHeight: number | undefined): number;
/**
 * The device's logical (dp) width of the DISPLAYED frame — the percent-mode
 * basis: displayW / density. A landscape frame therefore uses its landscape
 * dp width (≈915dp for a 412×915 phone) as its 100%.
 */
export declare function androidPanelDisplayLogicalWidthOf(naturalWidth: number | undefined, naturalHeight: number | undefined): number;
/**
 * Snaps a measured/computed CSS px value to a whole pixel (Math.round).
 *
 * The frame and screen boxes split their border/padding evenly between the
 * left and right rims, so a FRACTIONAL width rounds differently at each
 * device-pixel edge at 2× DPR — one side of the bezel ends up a physical
 * pixel thicker. Round the width BEFORE deriving radius/box values (and
 * before applying the fit-mode frame width itself) so both rims rasterize
 * symmetrically; the ≤0.5px remainder then splits evenly under
 * `margin: 0 auto`. Non-positive/garbage input snaps to 0.
 */
export declare function androidPanelSnapPxOf(value: number): number;
/**
 * The phone-frame CSS width one size mode applies: `100%` for fit (the
 * panel's drag-resize therefore scales the device), `dpWidth × value%` for
 * percent, and the aspect-aware preset width. Presets are SHORT-side sizes:
 * a landscape frame (aspect > 1) scales the preset by the width/height ratio
 * so the device keeps its physical size across a rotation.
 */
export declare function androidPanelFrameWidthOf(mode: AndroidPanelSizeMode, naturalWidth?: number, naturalHeight?: number): string;
/** Stable option id for one size mode (the dropdown's `value`). */
export declare function androidPanelSizeModeIdOf(mode: AndroidPanelSizeMode): string;
/** Defensive parse of a dropdown id; unknown ids fall back to fit. */
export declare function androidPanelSizeModeOf(id: string): AndroidPanelSizeMode;
export interface AndroidPanelQuickSizeOption {
    /** Dropdown option id this quick button maps to (shared truth). */
    id: string;
    /** The exact size mode dispatched to the store — the same object the
     * dropdown's option carries, so both controls stay in sync by id. */
    mode: AndroidPanelSizeMode;
    quickEn: string;
    quickZh: string;
}
/**
 * The toolbar's one-tap quick sizes: the most-used modes promoted out of the
 * dropdown as segmented buttons — [Fit/适应] [100%] [S] [M]. Each entry is
 * derived from the DROPDOWN roster, so pressing a quick button dispatches the
 * exact mode the dropdown selects and both stay in sync against the store's
 * single `sizeMode` truth.
 */
export declare const ANDROID_PANEL_QUICK_SIZE_OPTIONS: readonly AndroidPanelQuickSizeOption[];
