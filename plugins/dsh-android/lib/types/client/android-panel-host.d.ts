/**
 * Page-stable owner for the plugin-owned device panel.
 *
 * Mirrors dsh-openpencil's `mountEditorWorkbenchHost`: the rc.6 runtime has
 * no per-tool details seat, so the plugin mounts its own imperative React
 * root on `document.body` and docks the panel as a fixed right-hand column
 * that stays visible while the conversation scrolls. A dock lease on the DSH
 * root's `margin-right` (see android-panel-dock) pushes the AppFrame over so
 * the panel covers nothing; when the dock is unavailable (narrow viewport,
 * root missing, or another plugin owns the margin) the surface falls back to
 * a centered overlay. The left-edge handle drags the panel wider/narrower
 * (double-click resets to the default width), and while the streamed frame is
 * LANDSCAPE the panel auto-widens to a comfortable device-sized width —
 * restoring the user's portrait width when the device rotates back, and never
 * fighting a manual drag made during the landscape stint.
 *
 * "Landscape" is read straight off the frame's natural dimensions
 * (`naturalWidth > naturalHeight`): an Android frame follows the display
 * rotation, so there is no orientation vocabulary to track like dsh-ios had.
 *
 * Device switch: the panel's picker calls back through `onDeviceSwitched`;
 * the surface replaces the open request with a capsule-style synthetic
 * stream source (`androidSwitchedPanelRequestOf`, SAME request identity so
 * the mounted panel — and its size/frame state — survives the swap) via
 * `store.replaceOpen`, and keeps the panel-source registry entry in sync so
 * reopening stays on the new device.
 */
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client';
import type { AndroidSwitchResponse } from './protocol.js';
import { type AndroidPanelSizeMode } from './android-panel-size.js';
import { type AndroidFrameStyle } from './android-frame-style.js';
export interface AndroidPanelRequest {
    sessionId: string;
    callId: string;
    toolName: string;
    block: ToolCallBlock;
}
/** Stable identity of one request — reopening the same call is a no-op. */
export declare function androidPanelRequestKey(request: AndroidPanelRequest): string;
/**
 * Synthetic panel request for a switched device — the capsule-style source:
 * SAME session/call/tool identity (so the panel's request key — and the
 * mounted panel itself — never change: size/frame state and the in-flight
 * seeded grant survive the swap), but the block carries the new device's
 * `android-stream` meta, so panel meta follows the switch. The panel host
 * replaces the open store request AND the source-registry entry with this, so
 * closing/reopening (or a row click) stays on the new device.
 */
export declare function androidSwitchedPanelRequestOf(request: AndroidPanelRequest, result: AndroidSwitchResponse): AndroidPanelRequest;
type Listener = () => void;
export interface AndroidPanelStore {
    /** Snapshot for the ACTIVE Harness conversation only. */
    getSnapshot: () => AndroidPanelRequest | undefined;
    getActiveSessionId: () => string;
    setActiveSession: (sessionId: string) => void;
    /** AI-background preference for the active (or explicitly named) session. */
    getBackgroundMode: () => boolean;
    isBackgroundMode: (sessionId: string) => boolean;
    setBackgroundMode: (enabled: boolean, sessionId?: string) => void;
    /** The display size mode, isolated in-memory per conversation. */
    getSizeMode: () => AndroidPanelSizeMode;
    setSizeMode: (mode: AndroidPanelSizeMode) => void;
    /** The frame shell mode, isolated in-memory per conversation. */
    getFrameStyle: () => AndroidFrameStyle;
    setFrameStyle: (style: AndroidFrameStyle) => void;
    subscribe: (listener: Listener) => () => void;
    open: (request: AndroidPanelRequest) => boolean;
    /** Replace the OPEN request in place (device switch): same identity key,
     * new block — the mounted panel stays mounted and its meta follows. No-op
     * (false) while that session's panel is closed. */
    replaceOpen: (request: AndroidPanelRequest) => boolean;
    close: () => void;
    reset: () => void;
}
/** Session-indexed external store deliberately not owned by any Tool card. */
export declare function createAndroidPanelStore(): AndroidPanelStore;
/**
 * The one plugin-wide panel store instance. The page-owned panel host and the
 * input-dock status capsule subscribe to the SAME instance, so the capsule
 * can read the panel's open/closed state and open the panel itself. Created
 * lazily so headless renders never touch it; `createAndroidPanelStore` stays
 * exported for standalone tests.
 */
export declare function androidPanelStore(): AndroidPanelStore;
export interface AndroidPanelHostOptions {
    subscribeTheme: (listener: Listener) => () => unknown;
    getColorScheme: () => 'light' | 'dark';
    subscribeLocale: (listener: Listener) => () => unknown;
    getLocale: () => string;
    document?: Document;
}
export interface AndroidPanelHost {
    open: (request: AndroidPanelRequest) => boolean;
    /**
     * Open only while the panel is CLOSED (the auto-open path): an already-open
     * panel is never replaced, mirroring openpencil's `openIfIdle`. The store
     * snapshot is the single source of truth for open/closed — no second flag.
     */
    openIfIdle: (request: AndroidPanelRequest) => boolean;
    close: () => void;
    dispose: () => void;
}
export declare const ANDROID_PANEL_FULLSCREEN_BREAKPOINT = 760;
export declare const ANDROID_PANEL_MIN_WIDTH = 320;
export declare const ANDROID_PANEL_MAX_WIDTH = 960;
export declare const ANDROID_PANEL_LEFT_CLEARANCE = 640;
export declare const ANDROID_PANEL_DEFAULT_WIDTH = 380;
export interface AndroidPanelWidthBounds {
    min: number;
    max: number;
    initial: number;
}
/** Keep useful DSH conversation space while allowing a large landscape canvas. */
export declare function androidPanelWidthBounds(viewportWidth: number): AndroidPanelWidthBounds;
export declare function clampAndroidPanelWidth(width: number, viewportWidth: number): number;
/** A left-edge drag grows the docked panel as the pointer moves left. */
export declare function resizedAndroidPanelWidth(startWidth: number, startClientX: number, clientX: number, viewportWidth: number): number;
/** Comfortable landscape display height the auto-widen target fits (px). */
export declare const ANDROID_PANEL_LANDSCAPE_HEIGHT_PX = 420;
/** One display report for the panel host: the frame's natural pixel size. */
export interface AndroidPanelDisplayReport {
    naturalWidth: number | undefined;
    naturalHeight: number | undefined;
}
/** True while the streamed frame is wider than tall (a landscape stint). */
export declare function androidPanelDisplayIsLandscape(naturalWidth: number | undefined, naturalHeight: number | undefined): boolean;
/**
 * The comfortable landscape panel width: the width a landscape frame needs at
 * ~420px of displayed height, falling back to the 412×915 phone aspect while
 * no natural size is known, clamped into the live bounds and snapped to a
 * whole CSS px.
 */
export declare function androidPanelLandscapeTargetWidthOf(bounds: AndroidPanelWidthBounds, naturalWidth: number | undefined, naturalHeight: number | undefined): number;
/**
 * The panel width state machine behind the resize handle and the landscape
 * auto-widen. Pure (no DOM, no React) so the dev-panel-smoke script drives it
 * action by action:
 *
 * - `display` — the panel's frame report. Entering a landscape stint saves
 *   the current preferred width; leaving it restores that width; the stint
 *   boundary also clears the user-override flag.
 * - `manual-width` — a finished handle drag or a double-click reset. In a
 *   landscape stint it sets the user-override flag so the auto-widen never
 *   fights the user's explicit choice.
 */
export interface AndroidPanelWidthState {
    /** The user's preferred width (last drag / reset / restored width). */
    preferred: number;
    /** Width saved when entering a landscape stint (restored on return). */
    portraitWidth: number | undefined;
    /** Whether the last report was landscape (undefined = nothing reported). */
    landscape: boolean | undefined;
    /** Natural frame dims (the landscape target's device aspect). */
    naturalWidth: number | undefined;
    naturalHeight: number | undefined;
    /** True once the user manually sized the panel during this landscape stint. */
    userOverrode: boolean;
}
export type AndroidPanelWidthAction = {
    kind: 'display';
    naturalWidth?: number;
    naturalHeight?: number;
} | {
    kind: 'manual-width';
    width: number;
};
export declare function androidPanelWidthStateInitial(preferred: number): AndroidPanelWidthState;
export declare function androidPanelWidthStateNext(state: AndroidPanelWidthState, action: AndroidPanelWidthAction): AndroidPanelWidthState;
/**
 * The live panel width: the user's preference, auto-widened to the
 * comfortable landscape target while the frame is landscape and the user has
 * not manually sized the panel during this stint, then clamped into the
 * current viewport bounds.
 */
export declare function androidPanelEffectiveWidth(state: AndroidPanelWidthState, viewportWidth: number): number;
/**
 * Mount one imperative React root for the whole plugin panel (mirrors
 * openpencil's `mountEditorWorkbenchHost`). Safe to call only in a browser;
 * the options surface lets a headless embed pass its own document.
 */
export declare function mountAndroidPanelHost(options: AndroidPanelHostOptions): AndroidPanelHost;
export {};
