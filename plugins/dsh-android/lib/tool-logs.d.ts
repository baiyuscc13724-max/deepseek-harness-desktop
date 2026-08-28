/**
 * Model-facing logcat capture for the Android plugin.
 *
 * `android_logs` wraps `adb logcat` in two bounded modes, the same contract
 * dsh-ios's `ios_sim_logs` offers over the unified log:
 *
 * - `snapshot`: the recent persisted ring (`logcat -d -v time -T <timestamp>`),
 *   where the timestamp is computed from the DEVICE clock — a phone in another
 *   timezone would otherwise be handed a start time from the future and return
 *   nothing;
 * - `follow`: a live capture window that returns everything accumulated once
 *   `duration_seconds` elapses — a bounded capture, never a hanging stream:
 *   the tool call settles when the window closes.
 *
 * Output is capped *while capturing* (a tail ring of ~300 lines / ~30 KB, plus
 * a one-line hint naming the narrowing params), so a chatty device can never
 * drown the model no matter how much it emits — and Android emits a lot: a
 * stock emulator idles at hundreds of lines a second.
 *
 * The spawned adb child is reaped on window close, on abort, and on the hard
 * safety deadline through a process-GROUP kill: `adb logcat` keeps a server
 * connection open, and killing only the direct child would leave the device
 * side streaming.
 * @module @zseven-w/dsh-android/tool-logs
 */
import { type ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { AndroidHostController } from './android-host.js';
import type { AndroidDeviceInfo } from './tools.js';
/** Output cap: keep the tail of at most ~300 lines / ~30 KB, always. */
export declare const MAX_LOG_LINES = 300;
export declare const MAX_LOG_BYTES: number;
/** Log buffers `logcat -b` accepts (the ones worth exposing). */
export declare const LOG_BUFFERS: readonly ["main", "system", "crash", "events", "radio", "all"];
export type AndroidLogBuffer = (typeof LOG_BUFFERS)[number];
/** logcat priority thresholds (`*:<P>`). */
export declare const LOG_PRIORITIES: readonly ["V", "D", "I", "W", "E", "F"];
export type AndroidLogPriority = (typeof LOG_PRIORITIES)[number];
export type AndroidLogsMode = 'snapshot' | 'follow';
export interface AndroidLogsArgs {
    device?: string;
    mode?: AndroidLogsMode;
    /** snapshot window, e.g. "2m", "30s", "1h". Default "2m". */
    duration?: string;
    /** follow window in seconds, 1..60 (clamped). Default 10. */
    duration_seconds?: number;
    /** Package whose process the capture is limited to (`--pid=$(pidof -s …)`). */
    bundle_id?: string;
    /** logcat tag filter, e.g. "ActivityManager". */
    tag?: string;
    /** Minimum priority; V D I W E F. */
    priority?: AndroidLogPriority;
    /** Log buffer to read. */
    buffer?: AndroidLogBuffer;
    /** JavaScript regular expression; a leading PCRE-style `(?i)` enables case-insensitive matching. */
    grep?: string;
}
export interface AndroidLogsResult {
    device: AndroidDeviceInfo;
    mode: AndroidLogsMode;
    /** Human-readable capture window, e.g. "last 2m" or "follow 10s". */
    window: string;
    /** Number of log lines returned (the truncation hint is not counted). */
    lineCount: number;
    /** True when more log lines existed than were returned. */
    truncated: boolean;
    /** Tail of captured lines; the final element is the hint when truncated. */
    lines: string[];
    /** Pid the capture was limited to, when bundle_id resolved one. */
    pid?: number;
    /** How the capture was narrowed, when the device clock could not be read. */
    note?: string;
}
/** The tool definition bound to one host controller. */
export interface AndroidLogTools {
    androidLogs: ToolDefinition;
}
interface LogCapture {
    lines: string[];
    truncated: boolean;
}
/**
 * Tail ring of cleaned log lines, capped by count AND byte budget WHILE
 * capturing. Ported unchanged in behaviour from dsh-ios tool-logs.ts: the cap
 * must bite during the capture, not after, or a `logcat -d` on a busy device
 * buffers megabytes before anyone can trim it.
 */
export declare class LogLineRing {
    #private;
    lines: string[];
    bytes: number;
    truncated: boolean;
    push(chunk: Buffer): void;
    /**
     * Flush the trailing unterminated line. A follow window is closed by
     * SIGTERM, so the capture routinely ends mid-line — without this the last
     * (often the most interesting) line was silently dropped.
     */
    flush(): void;
}
interface RunLogOptions {
    adb: string;
    serial: string;
    /** Arguments after `adb -s <serial>`. */
    args: readonly string[];
    /** Follow-mode window: SIGTERM the child after this many ms (normal return). */
    windowMs?: number;
    signal: AbortSignal;
}
/**
 * Spawn `adb -s <serial> logcat …` and stream its stdout through the capped
 * ring until the window closes (follow), the child exits (snapshot), or the
 * caller's signal aborts. The child group is always reaped.
 */
export declare function runLogCapture(options: RunLogOptions): Promise<LogCapture>;
/** Validate the snapshot window and return it verbatim (default 2m). */
export declare function snapshotDuration(value: string | undefined): string;
/** `2m` → 120. The pattern above guarantees the shape. */
export declare function durationSeconds(duration: string): number;
/** Follow-mode window in seconds: integer ≥ 1, clamped to the 60 s maximum. */
export declare function followSeconds(value: number | undefined): number;
/** Client-side grep compiled once per call; invalid patterns fail loudly. */
export declare function compileGrep(value: string | undefined): RegExp | undefined;
/**
 * The `-T` start timestamp for a snapshot, computed ON THE DEVICE.
 *
 * logcat timestamps are in the device's local time with no zone marker, so a
 * start time computed from the HOST clock is silently wrong for any phone in
 * another timezone (and for an emulator whose clock has drifted) — usually far
 * enough in the future that the snapshot comes back empty, which reads like
 * "the app logged nothing". `seconds` is a validated integer, so the arithmetic
 * expansion below carries no untrusted text.
 */
export declare function deviceStartTimestamp(host: AndroidHostController, serial: string, seconds: number): Promise<string | undefined>;
/** Resolve a package's pid for `--pid=`, or throw with what to do instead. */
export declare function resolvePackagePid(host: AndroidHostController, serial: string, packageName: string): Promise<number>;
/**
 * Apply the client-side grep, then re-assert the cap defensively (grep can
 * only shrink the ring, so this is a no-op unless a stray line is oversized).
 */
export declare function postProcess(capture: LogCapture, grep: RegExp | undefined): {
    lines: string[];
    truncated: boolean;
};
/** Create the `android_logs` tool definition bound to one host controller. */
export declare function createAndroidLogTools(host: AndroidHostController): AndroidLogTools;
export {};
