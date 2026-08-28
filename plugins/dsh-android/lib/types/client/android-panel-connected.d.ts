/**
 * The connected device panel: resolves the tool result's presentationMeta (or,
 * for nested Code Mode calls, reconstructs it from the durable result text)
 * and renders the live stream (boot / build-run) or the static screenshot
 * (screenshot / interact) inside the phone frame.
 *
 * It owns everything the pure chrome (android-panel.tsx) must not know about:
 *
 * - the stream session (grant → img, control POSTs), so the top toolbar can
 *   reach the ◁ ○ □ nav keys, rotate, refresh;
 * - the header device picker + the switch/seeded-grant handshake: picking a
 *   device POSTs `/switch-device`, shows 切换中… while the old stream closes,
 *   seeds the returned capability into the session and swaps the panel meta
 *   to the new device; the panel host replaces the open request/source in
 *   place so store and registry follow. Size and frame state are untouched;
 * - the server-truth resync: when a grant falls back, `/status` is asked what
 *   is ACTUALLY streaming and the panel adopts it, so the panel and the host
 *   can never disagree about the streamed device;
 * - auto-follow: while the panel is open (and the host passed its sessionId)
 *   it re-targets to the session's NEWEST settled result — a stable target
 *   for `ANDROID_PANEL_FOLLOW_DEBOUNCE_MS`, never during a switch, and never
 *   after a manual pick until 恢复跟随 is clicked;
 * - the capture controller behind the toolbar's 截图 button and the device
 *   menu's five actions.
 *
 * Unlike dsh-ios there is exactly ONE device class: an emulator and a USB
 * phone are the same adb serial on the same stream path, so there is no
 * real-device session, no WDA progress surface and no device-kind branching.
 */
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client';
import { type AndroidLocale } from './copy.js';
import { type AndroidFetcher, type AndroidSwitchResponse } from './protocol.js';
import type { CompatibleToolDetailsViewProps } from './details-compat.js';
import { type AndroidPanelSizeMode } from './android-panel-size.js';
import { type AndroidFrameStyle } from './android-frame-style.js';
import type { AndroidPanelDisplayReport } from './android-panel-host.js';
export interface AndroidPanelProps {
    toolName: string;
    block: ToolCallBlock;
    /**
     * The session the panel belongs to (the panel host passes the open
     * request's sessionId). Present → auto-follow is enabled. Absent (the
     * per-tool details seat) → follow stays off.
     */
    sessionId?: string;
    fetcher?: AndroidFetcher;
    colorScheme: 'light' | 'dark';
    locale: AndroidLocale;
    onClose?: () => void;
    backgroundMode?: boolean;
    onBackgroundModeChange?: (enabled: boolean) => void;
    /** Controlled size mode (the panel host owns it via the panel store). */
    sizeMode?: AndroidPanelSizeMode;
    /** Controlled size-mode change (absent → internal state, fit default). */
    onSizeModeChange?: (mode: AndroidPanelSizeMode) => void;
    /** Controlled frame shell mode (absent → internal state, bezel default). */
    frameStyle?: AndroidFrameStyle;
    /** Controlled frame-style change (absent → internal state). */
    onFrameStyleChange?: (style: AndroidFrameStyle) => void;
    /** Frame display report for the panel host (its landscape auto-widen). */
    onDisplayChange?: (display: AndroidPanelDisplayReport) => void;
    /** A successful device switch — the panel already adopted the new device
     * (synthetic meta + seeded grant); the host uses this to replace the open
     * request/source so the store and registry follow the switch. */
    onDeviceSwitched?: (result: AndroidSwitchResponse) => void;
}
export declare function AndroidPanel({ toolName, block, fetcher, colorScheme, locale, onClose, backgroundMode, onBackgroundModeChange, sizeMode, onSizeModeChange, frameStyle, onFrameStyleChange, onDisplayChange, onDeviceSwitched, sessionId, }: AndroidPanelProps): React.JSX.Element;
export interface AndroidDetailsPanelProps {
    block: ToolCallBlock;
    colorScheme: 'light' | 'dark';
    locale: string;
}
/**
 * Per-tool details-seat renderer for DSH runtimes that declare
 * `tool.details.toolview` (absent in rc.6 — registration is guarded by
 * `ctx.slots.inject`). The native details column supplies its own header and
 * close control, so the panel body renders without `onClose`.
 */
export declare function AndroidDetailsPanel({ block, colorScheme, locale, }: AndroidDetailsPanelProps & CompatibleToolDetailsViewProps): React.JSX.Element;
