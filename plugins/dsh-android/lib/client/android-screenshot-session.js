/**
 * Shared screenshot grant session for the dsh-android surfaces.
 *
 * POST `/_dsh/dsh-android/grant` `{kind:'screenshot', path}` → render the
 * minted origin-relative PNG. Same failure policy as the stream session:
 * an initial grant failure falls back with a retry; an img error after a
 * successful grant re-grants once automatically before falling back. Unmount
 * drops the img src.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { requestScreenshotGrant, } from './protocol.js';
/** Grant → PNG session shared by the screenshot card and the panel. */
export function useAndroidScreenshot(options) {
    const { meta, fetcher, unavailableCopy } = options;
    const [phase, setPhase] = useState('granting');
    const [grant, setGrant] = useState();
    const [failure, setFailure] = useState('');
    const [attempt, setAttempt] = useState(0);
    const autoRetriedRef = useRef(false);
    const generationRef = useRef(0);
    const imgRef = useRef(null);
    const autoReGrant = useCallback(() => {
        if (autoRetriedRef.current) {
            setFailure(unavailableCopy);
            setPhase('fallback');
        }
        else {
            autoRetriedRef.current = true;
            setAttempt(current => current + 1);
        }
    }, [unavailableCopy]);
    const refresh = useCallback(() => {
        autoRetriedRef.current = false;
        setFailure('');
        setAttempt(current => current + 1);
    }, []);
    useEffect(() => {
        const generation = generationRef.current + 1;
        generationRef.current = generation;
        let disposed = false;
        setPhase('granting');
        setGrant(undefined);
        setFailure('');
        void requestScreenshotGrant(fetcher ?? fetch, meta.path).then(result => {
            if (disposed || generation !== generationRef.current)
                return;
            if (!result.ok) {
                setFailure(result.error);
                setPhase('fallback');
                return;
            }
            setGrant(result.grant);
            setPhase('live');
        });
        return () => {
            disposed = true;
            generationRef.current += 1;
            imgRef.current?.removeAttribute('src');
        };
    }, [attempt, meta.path, autoReGrant, fetcher]);
    return {
        phase,
        screenshotUrl: grant?.screenshotUrl,
        failure,
        imgRef,
        refresh,
        retryOnce: autoReGrant,
    };
}
