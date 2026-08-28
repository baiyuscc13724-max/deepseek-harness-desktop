/**
 * The panel's device-actions menu: the five device-level gestures the host
 * exposes (`ANDROID_DEVICE_ACTIONS`), reachable from the toolbar.
 *
 * Shape: one icon button (sliders) in the same pill language as the other
 * toolbar icons, opening a small command list BELOW it. Unlike the device
 * picker this is not a value selector — nothing stays "selected" — so it is a
 * plain popover of buttons rather than an `AndroidSelect`.
 *
 * Every action works on every device: adb does not distinguish emulators from
 * phones, so there is no per-backend availability table (the dsh-ios
 * simulator-only rows have no counterpart here) and no row is ever disabled
 * for the device kind.
 *
 * @module @zseven-w/dsh-android/client/android-device-menu
 */
import type { CSSProperties } from 'react';
import type { AndroidCopy } from './copy.js';
import { type AndroidDeviceActionName } from './protocol.js';
/** Actions the menu offers, in render order (mirrors the host's table). */
export declare const ANDROID_DEVICE_MENU_ACTIONS: readonly AndroidDeviceActionName[];
export type AndroidDeviceMenuAction = AndroidDeviceActionName;
/** Localized label for one action. */
export declare function androidDeviceActionLabelOf(action: AndroidDeviceMenuAction, copy: AndroidCopy): string;
/** The sliders glyph, in the toolbar's 16×16 stroke-icon language. */
export declare const ANDROID_DEVICE_MENU_ICON_PATHS: readonly string[];
export declare const ANDROID_DEVICE_MENU_STYLES: Record<string, CSSProperties>;
export interface AndroidDeviceMenuProps {
    copy: AndroidCopy;
    /** Runs one action; rejections surface through `onError`. */
    onAction: (action: AndroidDeviceMenuAction) => Promise<void> | void;
    /** Reports a failed action so the panel can show its own message. */
    onError?: (message: string) => void;
    /** Force-open for the static smoke (absent → internal state). */
    open?: boolean;
}
/**
 * The menu. Closes on outside pointerdown, on Escape, and after a successful
 * action — a failed one keeps it open so the next attempt is one click away.
 */
export declare function AndroidDeviceMenu({ copy, onAction, onError, open: openOverride, }: AndroidDeviceMenuProps): React.JSX.Element;
