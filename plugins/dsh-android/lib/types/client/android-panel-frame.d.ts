/**
 * The panel's phone frame: the shell around the device screen, in the three
 * user-selectable frame styles (frameless / bezel / phone frame).
 *
 * Sized by the active `sizeMode`: fit fills the stage width (so the panel's
 * drag-resize scales the device), percent/preset use the computed pixel width
 * from `androidPanelFrameWidthOf`. The width, aspect ratio, stream fill and
 * pointer mapping are IDENTICAL across all three styles — only the shell
 * around the screen changes.
 *
 * Corner radii follow the Android display proportion (30/412 of the displayed
 * screen's short side). Percent/preset widths are deterministic px values, so
 * their radius derives from props exactly on every render (SSR included);
 * fit mode's `100%` is only known to the DOM, so a mount-time measure plus a
 * ResizeObserver keeps two things live: (a) the measured screen radius, and
 * (b) the fit frame's SNAPPED integer width — a fractional border-box would
 * round differently at each device-pixel edge at 2× DPR and one bezel rim
 * would gain a physical pixel. Radius updates are style-only: the children
 * (stream/screenshot img) are never remounted, so the stream never
 * reconnects on resize.
 */
import type { CSSProperties, ReactNode } from 'react';
import { type AndroidPanelSizeMode } from './android-panel-size.js';
import { type AndroidFrameStyle } from './android-frame-style.js';
/**
 * The phone bezel — the one deliberately dark device surface (a bezel is a
 * device frame, not a panel surround), exported so the smoke can allow-list
 * it. The screen inside stays black: it is the device display. The outer
 * corner radius is applied per render (screen radius + the 6px rim) so the
 * inset screen stays concentric at every displayed size. The 1px border is
 * part of the rim: the screen-width derivation subtracts it together with the
 * padding, so left/right rims measure pad+border.
 */
export declare const PHONE_BEZEL_STYLES: CSSProperties;
/**
 * Frameless mode (无框): no shell at all. The wrapper is a bare sizing
 * element ONLY — no padding, no background, no border, no shadow, no clip:
 * the screen div below IS the content box and carries the proportional corner
 * clip directly, so no black layer can ever peek out around the stream.
 */
export declare const FRAMELESS_FRAME_STYLES: CSSProperties;
/**
 * Phone frame mode (手机框): a realistic CSS-only device shell — a thicker
 * 16px shell with a subtle dark metallic gradient, a 1px lighter inner edge
 * highlight where the shell meets the screen, and the slim bezel's soft drop
 * shadow. The outer corner radius is applied per render (screen radius + the
 * 16px shell), and the side-button nubs anchor to this wrapper.
 */
export declare const DEVICE_FRAME_STYLES: CSSProperties;
/**
 * The phone frame's side-button nubs, positioned proportionally along the
 * frame's height. Android hardware overwhelmingly puts the volume rocker
 * ABOVE the power key on the RIGHT edge, so that is what is drawn. Buttons
 * render only in portrait: in landscape the wide frame's edges correspond to
 * the device's top/bottom and rotating the nubs would need a second
 * coordinate system for a purely decorative detail.
 */
export declare const DEVICE_SIDE_BUTTONS: readonly {
    id: string;
    side: 'left' | 'right';
    style: CSSProperties;
}[];
/**
 * The frame with one size mode applied: the width comes from the pure
 * `androidPanelFrameWidthOf` helper and the base max-width clamp is removed
 * so fit/percent/preset widths are exact (overflow scrolls the panel stage).
 * `frameStyle` picks the shell; `screenRadius` drives its outer radius.
 *
 * Fit mode resolves `100%` against the stage's content box, which can be
 * FRACTIONAL after a panel drag-resize. `measuredFitWidth` (snapped to a
 * whole CSS px by AndroidPhoneFrame's ResizeObserver) replaces the `100%`
 * once measured, so the frame's border-box lands on the device-pixel grid and
 * its rims rasterize symmetrically; the ≤0.5px remainder splits evenly under
 * `margin: 0 auto`.
 */
export declare function androidPanelFrameStyles(mode: AndroidPanelSizeMode, naturalWidth: number | undefined, naturalHeight: number | undefined, frameStyle?: AndroidFrameStyle, screenRadius?: number, measuredFitWidth?: number): CSSProperties;
/**
 * The inset screen for one frame style. Bezel and phone-frame keep the
 * classic screen (black device display, hairline edge highlight, proportional
 * radius concentric with the shell's outer radius). Frameless has NO black
 * layers at all: the background goes transparent and the border drops, so the
 * screen IS the bare content box and its radius IS the only rounding.
 */
export declare function androidPhoneScreenStyles(frameStyle: AndroidFrameStyle, screenRadius: number): CSSProperties;
export interface AndroidPhoneFrameProps {
    children: ReactNode;
    sizeMode?: AndroidPanelSizeMode;
    /** Natural pixel width of the current frame (size basis + screen aspect). */
    naturalWidth?: number;
    /** Natural pixel height of the current frame (screen aspect). */
    naturalHeight?: number;
    /** Frame shell mode (defaults to the slim bezel). */
    frameStyle?: AndroidFrameStyle;
}
/** Minimal CSS phone frame: shell + inset screen, sized by the active mode. */
export declare function AndroidPhoneFrame({ children, sizeMode, naturalWidth, naturalHeight, frameStyle, }: AndroidPhoneFrameProps): React.JSX.Element;
