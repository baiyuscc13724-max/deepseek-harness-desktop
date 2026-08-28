/**
 * Capability tokens and the transport fence for the dsh-android web routes.
 *
 * Ported from dsh-ios stream-routes.ts with the same security posture:
 * - HMAC-SHA256 capabilities `base64url(payload).base64url(mac)`, signed with
 *   a 32-byte per-DSH-home key (`<DSH_HOME>/cache/dsh-android/
 *   stream-access.key`, 0600, created atomically); tokens expire within 10
 *   minutes.
 * - Every route also applies the loopback/trusted transport fence (peer
 *   address, loopback Host, Fetch-Metadata/Origin) BEFORE any capability is
 *   consulted — Host/Origin are caller-controlled data, so a LAN client
 *   cannot spoof localhost and a DNS-rebinding Host is rejected.
 * - The screenshot route serves exactly one directory, walked with lstat
 *   (no symlinks) and finished with a realpath containment check.
 * @module @zseven-w/dsh-android/stream-access
 */
import type { IncomingMessage } from 'node:http';
/** Hard capability lifetime (tokens expire within 10 minutes). */
export declare const TOKEN_TTL_MS: number;
export interface StreamTokenPayload {
    v: 1;
    kind: 'android-stream';
    serial: string;
    exp: number;
}
export interface ScreenshotTokenPayload {
    v: 1;
    kind: 'android-screenshot';
    path: string;
    exp: number;
}
/** Plugin-managed state root (mirrors the dsh-ios convention). */
export declare function stateRoot(): string;
/**
 * Screenshot cache: the only directory the screenshot route will serve.
 * Shared with the tools' capture store so every android_screenshot output
 * can be granted a capability without further configuration.
 */
export declare function screenshotDir(): string;
/** Load or atomically create the per-DSH-home signing key (0600). */
export declare function prepareStreamAccessKey(): Promise<Buffer>;
/** HMAC capability encoder/verifier for stream and screenshot URLs. */
export declare class StreamAccessController {
    #private;
    private readonly resolveKey;
    constructor(resolveKey?: () => Promise<Buffer>);
    /** Whether at least one HTTP carrier currently owns the routes. */
    get routeAvailable(): boolean;
    /** Mark one route attachment; the returned disposer removes it. */
    attachRoute(): () => void;
    /** Mint a stream capability for one device serial. */
    signStreamToken(serial: string, options?: {
        ttlMs?: number;
    }): Promise<{
        token: string;
        expiresAt: number;
    }>;
    /** Mint a screenshot capability for one absolute path in the cache dir. */
    signScreenshotToken(path: string, options?: {
        ttlMs?: number;
    }): Promise<{
        token: string;
        expiresAt: number;
    }>;
    verifyStreamToken(token: string): Promise<StreamTokenPayload | undefined>;
    verifyScreenshotToken(token: string): Promise<ScreenshotTokenPayload | undefined>;
}
/**
 * Trust the transport peer, never forwarded or caller-controlled host data.
 * Node may expose an IPv4 peer directly or as an IPv4-mapped IPv6 address,
 * including the compact hexadecimal form used by some platforms.
 */
export declare function isLoopbackRemoteAddress(address: string | undefined): boolean;
/** The transport fence applied to every dsh-android route. */
export declare function isTrustedRequest(req: IncomingMessage, requireOrigin: boolean): boolean;
export type ScreenshotVerdict = 'ok' | 'outside' | 'missing';
/**
 * Walk `path` from the screenshot cache root with `lstat` (refusing any
 * symbolic link) and finish with a `realpath` containment check.
 */
export declare function classifyScreenshotPath(path: string): Promise<ScreenshotVerdict>;
/**
 * Open the verified screenshot with `O_NOFOLLOW`, bounded in size, and
 * re-validate containment so a file swapped for a symlink between minting
 * and fetching is never served.
 */
export declare function openVerifiedScreenshot(path: string): Promise<{
    bytes: Buffer;
} | undefined>;
