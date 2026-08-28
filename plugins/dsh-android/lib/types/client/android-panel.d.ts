/**
 * The persistent device panel's pure chrome — device header with the picker,
 * a compact top toolbar (segmented size quick pill | divider | the icon pill
 * with ◁ Back · ○ Home · □ Recents · Screenshot · Rotate · Refresh), the
 * phone-frame stage, and the "● Live" indicator (stream mode only;
 * screenshot-mode panels hide the live/offline readout entirely).
 *
 * The chrome follows the DSH theme with the exact tokens dsh-openpencil's
 * editor panel uses (`--dsw-alias-*`): background, header border, toolbar,
 * captions and status text all track the active light/dark theme. Only the
 * phone bezel stays a literal dark device frame (the allowed exception, see
 * android-panel-frame.tsx).
 *
 * Everything here is pure presentation the dev-panel-smoke script
 * server-renders phase by phase without a browser or network; the connected
 * surface (grant/stream sessions, device switch, auto-follow) lives in
 * android-panel-connected.tsx.
 */
import type { CSSProperties, ReactNode, RefObject } from 'react';
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client';
import { type AndroidLocale } from './copy.js';
import type { AndroidDeviceInfo, AndroidFetcher, AndroidScreenshotMeta } from './protocol.js';
import type { AndroidCapturePhase } from './android-panel-capture.js';
import { type AndroidPanelSizeMode } from './android-panel-size.js';
import { type AndroidFrameStyle } from './android-frame-style.js';
import { type AndroidDeviceMenuAction } from './android-device-menu.js';
/**
 * Panel chrome styles over the DSH theme tokens (no literal colors — the
 * host's `--dsw-alias-*` variables resolve per theme; the phone bezel is the
 * one deliberate dark device surface). Exported so the static smoke can
 * assert the token usage directly.
 */
export declare const PANEL_STYLES: Record<string, CSSProperties>;
/**
 * "● Live" / gray "Offline" readout under the frame. The text color follows
 * the theme token; only the dot keeps its literal green/gray state colors.
 */
export declare const PANEL_LIVE_INDICATOR_STYLES: CSSProperties;
export declare function AndroidLiveIndicator({ open, locale }: {
    open: boolean;
    locale: AndroidLocale;
}): React.JSX.Element;
/**
 * Auto-follow header styles — the same compact token pill language as the
 * picker's switching/error readouts. Only the live-green dot keeps a literal
 * state color (the panel-wide live-dot convention).
 */
export declare const ANDROID_FOLLOW_INDICATOR_STYLES: Record<string, CSSProperties>;
/**
 * The small auto-follow header indicator: while following is active a muted
 * 自动跟随/Auto-follow pill with the live-green dot; after a manual pick it
 * becomes the one-click 恢复跟随/Resume following button — visible AND
 * reversible. Pure presentation, SSR-safe.
 */
export declare function AndroidFollowIndicator({ overridden, locale, onResume, }: {
    overridden: boolean;
    locale: AndroidLocale;
    onResume?: () => void;
}): React.JSX.Element;
/** The panel's three modes — there is no device-class split on Android. */
export type AndroidPanelMode = 'stream' | 'screenshot' | 'unavailable';
export interface AndroidPanelBodyProps {
    title: string;
    device: AndroidDeviceInfo | undefined;
    /** Header device picker. When present it replaces the static device-name
     * subtitle; a meta-less 'unavailable' panel keeps the subtitle. */
    devicePicker?: ReactNode;
    /** Small auto-follow pill rendered next to the picker/subtitle. */
    followIndicator?: ReactNode;
    mode: AndroidPanelMode;
    liveOpen: boolean;
    colorScheme: 'light' | 'dark';
    locale: AndroidLocale;
    onClose?: () => void;
    /** Suppress automatic panel opening while background AI tools stay usable. */
    backgroundMode?: boolean;
    onBackgroundModeChange?: (enabled: boolean) => void;
    children: ReactNode;
    /** Active display size mode (defaults to fit). */
    sizeMode?: AndroidPanelSizeMode;
    /** Natural pixel size of the current stream/screenshot frame. */
    naturalWidth?: number;
    naturalHeight?: number;
    /** Size-mode change (absent → the controls still render, inert). */
    onSizeModeChange?: (mode: AndroidPanelSizeMode) => void;
    /** Active frame shell mode (defaults to the slim bezel). */
    frameStyle?: AndroidFrameStyle;
    /** Frame-style change (absent → the control still renders, inert). */
    onFrameStyleChange?: (style: AndroidFrameStyle) => void;
    /** Toolbar actions — each button renders only when its handler is present.
     * The nav triad (◁ ○ □) shares one handler keyed by the button name. */
    onNavButton?: (name: 'back' | 'home' | 'recents') => void;
    /** Runs one device action (notifications, lock, …); absent hides the menu. */
    onDeviceAction?: (action: AndroidDeviceMenuAction) => Promise<void> | void;
    onRotate?: () => void;
    onScreenshot?: () => void;
    onRefresh?: () => void;
    /** Screenshot capture confirmation state (busy/done toast in the toolbar). */
    captureState?: AndroidCapturePhase;
}
/** Pure panel chrome: header, toolbar, size-aware phone frame, Live dot. */
export declare function AndroidPanelBody({ title, device, devicePicker, mode, liveOpen, colorScheme, locale, onClose, backgroundMode, onBackgroundModeChange, children, followIndicator, sizeMode, naturalWidth, naturalHeight, onSizeModeChange, frameStyle, onFrameStyleChange, onNavButton, onDeviceAction, onRotate, onScreenshot, onRefresh, captureState, }: AndroidPanelBodyProps): React.JSX.Element;
export interface AndroidScreenshotFrameBodyProps {
    meta: AndroidScreenshotMeta;
    locale: AndroidLocale;
    phase: 'granting' | 'live' | 'fallback';
    screenshotUrl: string | undefined;
    failure: string;
    refresh: () => void;
    imgRef: RefObject<HTMLImageElement>;
    /** Reports the loaded PNG's natural pixel width (percent-size basis). */
    onNaturalSize?: (width: number) => void;
}
/** Pure screenshot-mode body (static PNG inside the phone screen). */
export declare function AndroidScreenshotFrameBody({ meta, locale, phase, screenshotUrl, failure, refresh, imgRef, onNaturalSize, }: AndroidScreenshotFrameBodyProps): React.JSX.Element;
export interface AndroidScreenshotFrameProps {
    meta: AndroidScreenshotMeta;
    fetcher?: AndroidFetcher;
    locale: AndroidLocale;
    onNaturalSize?: (width: number) => void;
}
/** Connected screenshot-mode frame: grant → static PNG in the phone screen. */
export declare function AndroidScreenshotFrame({ meta, fetcher, locale, onNaturalSize }: AndroidScreenshotFrameProps): React.JSX.Element;
/** Tool name the panel modes derive from (defensive over both block forms). */
export declare function androidToolNameOf(block: ToolCallBlock): string;
