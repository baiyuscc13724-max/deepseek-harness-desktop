/**
 * Client-side reconstruction of the dsh-android presentationMeta for nested
 * Code Mode (PTC) tool calls.
 *
 * DSH projects `output.presentationMeta` into a settled tool result ONLY for
 * top-level calls (harness `createSuccessResult`: `exec.parent === undefined`).
 * In Code Mode the model composes tools from a TypeScript program, so every
 * `android_*` call is a nested dispatch whose client block carries the FULL
 * durable result JSON in `content` but no `meta` — without this module the
 * cards degrade to the no-preview fallback and never register a panel source,
 * so the sidebar panel and the status capsule stay dead too.
 *
 * The plugin's presentationMeta is deliberately stable and fully derivable
 * from that durable result JSON:
 * - `android_boot`       → `{kind:'android-stream', device, streamRouteId}`
 *   (streamRouteId = `dsh-android/stream/<device.serial>`), gated on
 *   `streaming === true` with `state` of `'streaming'` (or legacy `'booted'`);
 * - `android_screenshot` → `{kind:'android-screenshot', screenshotPath, path,
 *   device}` from an ABSOLUTE `path` + a non-negative `bytes`;
 * - `android_interact`   → the same envelope (one shared host projector);
 * - `android_build_run`  → `{kind:'android-build-run', device, packageName,
 *   apkPath?}`, gated on `state === 'launched'`.
 *
 * Reconstructed screenshot paths are still validated as absolute paths here;
 * the host `/grant` route re-validates every path against the plugin cache
 * directory server-side (no symlink escape, cache-only), so rebuilding meta
 * client-side changes nothing about the trust boundary. Malformed, truncated,
 * or unexpected results resolve `null` (never a throw) and the cards keep
 * today's plain fallback UI.
 *
 * @module @zseven-w/dsh-android/client/android-meta-hydrate
 */
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client';
import { type AndroidMeta } from './protocol.js';
/** Where a card's presentation meta came from (debuggability only). */
export type AndroidMetaSource = 'meta' | 'hydrated';
/** The meta a card/panel should render plus its origin. */
export interface ResolvedAndroidMeta {
    meta: AndroidMeta;
    source: AndroidMetaSource;
}
/**
 * Rebuild the exact presentationMeta from a settled tool result's durable
 * JSON text (the first text content block that parses as a JSON object).
 * Resolves `null` — never throws — when the result cannot be validated, in
 * which case the cards keep today's plain fallback UI.
 */
export declare function hydrateAndroidMeta(toolName: string, block: ToolCallBlock): AndroidMeta | null;
/**
 * The single meta resolution every card and the panel share: the
 * host-projected `presentationMeta` always wins (standard-mode sessions are
 * untouched), and a nested Code Mode result reconstructs the same meta from
 * its durable JSON text. Unsettled/error results resolve `undefined`.
 */
export declare function resolveAndroidMeta(toolName: string, block: ToolCallBlock): ResolvedAndroidMeta | undefined;
