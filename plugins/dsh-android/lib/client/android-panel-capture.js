/**
 * The panel toolbar's 截图 (Screenshot) flow: POST `/_dsh/dsh-android/capture`
 * (the host captures a FRESH PNG of the current streamed device and signs a
 * relative screenshot URL), then `window.open(screenshotUrl, '_blank')` and a
 * transient "已截图 / Captured" inline confirmation in the toolbar that
 * auto-hides after ~2 s.
 *
 * The state machine lives in `createAndroidCaptureController` — a pure,
 * timer-injectable controller the dev-panel-smoke script drives with fake
 * timers and a mocked fetcher (no browser, no device). `useAndroidCapture`
 * binds it to React for the panel; it performs no network during render
 * (capture only ever runs from a click).
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { requestAndroidCapture, } from './protocol.js';
/** How long the "captured" confirmation stays visible (~2 s). */
export const ANDROID_CAPTURE_CONFIRM_MS = 2000;
const DEFAULT_CAPTURE_TIMERS = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: handle => clearTimeout(handle),
};
/**
 * The pure capture state machine, bound to an options ref so the React hook
 * can pass fresh fetcher/openWindow values without recreating the store.
 */
export function createAndroidCaptureController(optionsRef) {
    let phase = 'idle';
    let busy = false;
    let hideTimer;
    let disposed = false;
    const listeners = new Set();
    const emit = () => { for (const listener of listeners)
        listener(); };
    const setPhase = (next) => {
        if (phase === next)
            return;
        phase = next;
        emit();
    };
    const timersOf = () => optionsRef.current.timers ?? DEFAULT_CAPTURE_TIMERS;
    const clearHide = () => {
        if (hideTimer === undefined)
            return;
        timersOf().clearTimeout(hideTimer);
        hideTimer = undefined;
    };
    const openWindowOf = () => {
        const provided = optionsRef.current.openWindow;
        if (provided !== undefined)
            return provided;
        if (typeof window === 'undefined')
            return undefined;
        return (url, target) => { window.open(url, target); };
    };
    return {
        getPhase: () => phase,
        async capture(device) {
            if (busy || disposed)
                return false;
            busy = true;
            setPhase('busy');
            const fetcher = optionsRef.current.fetcher ?? fetch;
            const result = await requestAndroidCapture(fetcher, { device, sessionId: optionsRef.current.sessionId });
            busy = false;
            if (disposed)
                return false;
            if (!result.ok) {
                setPhase('idle');
                return false;
            }
            try {
                openWindowOf()?.(result.capture.screenshotUrl, '_blank');
            }
            catch {
                // a blocked popup still counts as captured — the URL was minted
            }
            setPhase('done');
            clearHide();
            hideTimer = timersOf().setTimeout(() => {
                hideTimer = undefined;
                if (!disposed)
                    setPhase('idle');
            }, optionsRef.current.autoHideMs ?? ANDROID_CAPTURE_CONFIRM_MS);
            return true;
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        dispose() {
            disposed = true;
            clearHide();
            listeners.clear();
        },
    };
}
/** React binding: capture on click → open minted URL + transient toast. */
export function useAndroidCapture(options) {
    const optionsRef = useRef(options);
    optionsRef.current = options;
    const [controller] = useState(() => createAndroidCaptureController(optionsRef));
    const phase = useSyncExternalStore(controller.subscribe, controller.getPhase, controller.getPhase);
    useEffect(() => () => controller.dispose(), [controller]);
    const capture = useCallback((device) => {
        void controller.capture(device);
    }, [controller]);
    return { phase, capture };
}
