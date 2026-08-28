/**
 * Shared screenshot grant session for the dsh-android surfaces.
 *
 * POST `/_dsh/dsh-android/grant` `{kind:'screenshot', path}` → render the
 * minted origin-relative PNG. Same failure policy as the stream session:
 * an initial grant failure falls back with a retry; an img error after a
 * successful grant re-grants once automatically before falling back. Unmount
 * drops the img src.
 */
import type { RefObject } from 'react';
import { type AndroidFetcher, type AndroidScreenshotMeta } from './protocol.js';
export type AndroidScreenshotPhase = 'granting' | 'live' | 'fallback';
export interface AndroidScreenshotSessionOptions {
    meta: AndroidScreenshotMeta;
    fetcher?: AndroidFetcher;
    /** Static fallback message shown once the auto-retry budget is spent. */
    unavailableCopy: string;
}
export interface AndroidScreenshotSession {
    phase: AndroidScreenshotPhase;
    screenshotUrl: string | undefined;
    failure: string;
    imgRef: RefObject<HTMLImageElement>;
    /** Manual refresh: clear the auto-retry budget and re-grant. */
    refresh: () => void;
    /** One automatic re-grant (img error), then the fallback. */
    retryOnce: () => void;
}
/** Grant → PNG session shared by the screenshot card and the panel. */
export declare function useAndroidScreenshot(options: AndroidScreenshotSessionOptions): AndroidScreenshotSession;
