/**
 * Row-click trigger for the plugin-owned device panel (the rc.6 fallback
 * surface — the per-tool `tool.details.toolview` seat is not declared by the
 * installed runtime, so this package opens its own right-side panel).
 *
 * Cards register their settled, meta-carrying results in the source registry
 * as they mount. A document-level capture listener turns a click on that
 * call's tool row (`[data-chat-call-id]` wrapper around the card) into an
 * open request — the same gesture DSH uses to open 详情 for a tool. Clicks on
 * interactive elements (buttons/links), on the live frame itself (which is
 * tap/drag surface for the device), and inside the panel never trigger. The
 * listener is installed only while the per-tool details seat is absent and is
 * disposed if a runtime later declares it.
 *
 * Every source carries the framework-supplied `sessionId` of the card that
 * registered it, and cards unregister on unmount — so after a session switch
 * the registry reflects only the CURRENT session's mounted results. The
 * stream-status capsule uses exactly that: it renders (and polls) only while
 * the current session has at least one source.
 */
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client';
export interface AndroidPanelSource {
    sessionId: string;
    callId: string;
    toolName: string;
    block: ToolCallBlock;
}
/** Remember one openable result; returns the unregister disposer. */
export declare function registerAndroidPanelSource(source: AndroidPanelSource): () => void;
/** Subscribe to panel-source registry changes (tool results landing/leaving). */
export declare function subscribeAndroidPanelSources(listener: () => void): () => void;
/** The registry change counter (stable between changes, for `useSyncExternalStore`). */
export declare function androidPanelSourcesVersion(): number;
/**
 * A point-in-time snapshot of every registered source. The panel's
 * auto-follow engine scans it for the newest settled result of the current
 * session and re-targets to that result's device.
 */
export declare function androidPanelSourcesSnapshot(): AndroidPanelSource[];
/**
 * True while at least one registered source belongs to the given session.
 * This is the capsule's session gate: a new empty session has no sources, so
 * the capsule stays hidden there even while the global stream runs.
 */
export declare function hasAndroidPanelSourceForSession(sessionId: string): boolean;
export declare function resolveAndroidPanelSource(callId: string): AndroidPanelSource | undefined;
/** Register a card's settled result while it is mounted. */
export declare function useAndroidPanelSource(enabled: boolean, source: AndroidPanelSource | undefined): void;
/** Elements whose clicks never open the panel. */
export declare const ANDROID_PANEL_INTERACTIVE_SELECTOR: string;
/** Structural face of an event target (satisfied by `Element` and fakes). */
export interface AndroidPanelClickTargetLike {
    closest(selector: string): {
        dataset?: Record<string, string | undefined>;
    } | null;
}
/** True when the click lands on a control or on a device surface itself. */
export declare function androidPanelClickIsInteractive(target: AndroidPanelClickTargetLike): boolean;
/** The tool-row call id the click addressed, if any. */
export declare function androidPanelClickRowCallIdOf(target: AndroidPanelClickTargetLike): string | undefined;
/**
 * Install the document-level row-click listener. Fires on the capture phase
 * so it observes the gesture before any inner handler; it never stops
 * propagation, so the host's own row behavior is untouched.
 */
export declare function installAndroidPanelRowTrigger(doc: Document, open: (source: AndroidPanelSource) => boolean): () => void;
