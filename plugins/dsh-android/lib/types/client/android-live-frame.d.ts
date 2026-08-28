/**
 * The live-stream frame consumed by the persistent right-side device panel
 * (the conversation cards are compact summaries with no imagery — the panel
 * is the only surface that shows the device).
 *
 * `AndroidLiveFrame` binds `useAndroidStream` (the single stream/pointer
 * engine) to a presentation; `AndroidLiveFrameBody` is the same presentation
 * as a pure component over an explicit session state, so the dev-panel-smoke
 * script can server-render the live and fallback phases without a network or
 * a browser.
 *
 * There is NO counter-rotation here (dsh-ios needed one because the simulator
 * framebuffer stayed portrait-sized): an Android frame follows the display
 * rotation, so the pointer box simply adopts the frame's own aspect ratio and
 * pointer coordinates normalized against it go straight to `/control`.
 *
 * The img's `load` event is the ONLY liveness signal this transport has (no
 * control WebSocket exists), so it feeds BOTH the session's live flag and the
 * caller's natural-size report.
 */
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { type AndroidStreamPhase } from './android-stream-session.js';
import { type AndroidLocale } from './copy.js';
import type { AndroidFetcher, AndroidStreamMeta } from './protocol.js';
/** The session fields the pure body renders from (subset of the hook). */
export interface AndroidLiveFrameSessionState {
    phase: AndroidStreamPhase;
    streamUrl: string | undefined;
    failure: string;
    imgRef: RefObject<HTMLImageElement>;
    refresh: () => void;
    retryOnce: () => void;
    /** The frame drew — the session's only liveness signal. */
    onFrameLoad: (naturalWidth: number, naturalHeight: number) => void;
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
}
export interface AndroidLiveFrameBodyProps {
    meta: AndroidStreamMeta;
    locale: AndroidLocale;
    session: AndroidLiveFrameSessionState;
    /** Natural pixel width of the loaded stream (size basis + frame aspect). */
    naturalWidth?: number;
    /** Natural pixel height of the loaded stream (frame aspect). */
    naturalHeight?: number;
    /** Reports the loaded stream's natural pixel size to the panel. */
    onNaturalSize?: (width: number, height: number) => void;
}
/**
 * Pure presentation of the live frame over an explicit session snapshot.
 * Exported for the static smoke: `phase: 'live' | 'fallback'` render without
 * any network or browser surface.
 */
export declare function AndroidLiveFrameBody({ meta, locale, session, naturalWidth, naturalHeight, onNaturalSize, }: AndroidLiveFrameBodyProps): React.JSX.Element;
export interface AndroidLiveFrameProps {
    meta: AndroidStreamMeta;
    fetcher?: AndroidFetcher;
    locale: AndroidLocale;
    onLiveChange?: (live: boolean) => void;
    onNaturalSize?: (width: number, height: number) => void;
}
/**
 * Hook-connected live frame: grant → stream img with the panel's exact
 * fallback/retry behavior. The panel binds the session itself (its toolbar
 * needs the button/rotate/refresh handles), so this wrapper exists for
 * standalone embeds and for the smoke's shared-engine identity assertion.
 */
export declare function AndroidLiveFrame({ meta, fetcher, locale, onLiveChange, onNaturalSize, }: AndroidLiveFrameProps): React.JSX.Element;
