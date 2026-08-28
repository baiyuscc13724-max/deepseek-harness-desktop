/**
 * Inline styles for the dsh-android cards. Same mechanism as dsh-ios /
 * dsh-openpencil: plain inline style objects over the host's `--ui-*` CSS
 * variables, so the cards track the active theme without a CSS framework.
 *
 * Unlike dsh-ios there is NO rotation group here: an Android `screencap`
 * frame already follows the display rotation (a landscape app streams a
 * 2400×1080 frame), so the panel never counter-rotates the image — it only
 * adopts the frame's own aspect ratio from `naturalWidth/naturalHeight`.
 */
import type { CSSProperties } from 'react';
export declare const CARD_STYLES: Record<string, CSSProperties>;
/** The stream/screenshot frame: dark console-like backdrop in both schemes. */
export declare function mediaFrameStyles(_colorScheme: 'light' | 'dark'): CSSProperties;
/**
 * Panel-variant styles for the shared live frame: the stream fills the phone
 * screen provided by the panel (no card chrome), so the frame is a full-bleed
 * column. The panel's actions live in the panel chrome's own top toolbar
 * (see android-panel.tsx), not inside the frame.
 *
 * The stage carries NO background of its own: the phone screen div provides
 * the backdrop (black in bezel/device, transparent in frameless — see
 * androidPhoneScreenStyles in android-panel-frame.tsx), so frameless mode
 * never leaks a dark layer between the frame wrapper and the stream img.
 */
export declare const PANEL_STREAM_STAGE_STYLES: CSSProperties;
/**
 * The pointer box inside the panel's phone screen: sized to the frame's own
 * aspect ratio (the frame is already display-rotated, so the aspect IS the
 * natural one). Pointer events land here and its bounds ARE the normalized
 * 0..1 coordinate space `/control` expects — no inverse mapping anywhere.
 */
export declare const PANEL_STREAM_BOX_STYLES: CSSProperties;
/**
 * The stream img inside the pointer box: absolutely positioned and `fill`
 * (NOT `contain`). The box's `aspectRatio` IS the frame's aspect, so `fill`
 * and `contain` draw the same picture — except that `contain` resolves any
 * sub-pixel box/device-pixel mismatch by leaving the slack on ONE side, which
 * at 2× DPR paints the adjacent bezel rim a physical pixel thicker there.
 * `fill` stretches edge-to-edge so residual slack distributes symmetrically.
 *
 * No background of its own: the screen's backdrop (black under a shell,
 * transparent in frameless) shows through wherever a letterbox could appear.
 */
export declare const PANEL_STREAM_IMG_STYLES: CSSProperties;
/**
 * The panel's screenshot img: fills the phone screen. `contain` STAYS here
 * (unlike the stream img above): screenshot mode never reports a natural
 * HEIGHT, so the phone screen's aspect derives from the 412:915 fallback
 * shape and matches the PNG only for 412:915-ratio devices. `fill` would
 * stretch any other device's screenshot; `contain` preserves it, and the
 * snapped integer frame width keeps the horizontal slack symmetric anyway.
 */
export declare const PANEL_SCREENSHOT_IMAGE_STYLES: CSSProperties;
/** Centered loading / fallback bodies inside the phone screen. */
export declare const PANEL_LOADING_STYLES: CSSProperties;
export declare const PANEL_FALLBACK_STYLES: CSSProperties;
