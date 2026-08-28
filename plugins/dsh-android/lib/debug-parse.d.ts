/**
 * Pure parsers for the Android debug tools, plus the one ANR-trace read that
 * has to touch the device.
 *
 * Split out of tool-debug.ts for the 800-line file rule, and it earns the
 * split: `ps`, `dumpsys meminfo` and `dumpsys package` all have shapes that
 * drift between Android versions, so having them here — as pure functions over
 * a captured string — is what lets the smoke feed recorded output through them
 * without a device.
 * @module @zseven-w/dsh-android/debug-parse
 */
import type { AndroidHostController } from './android-host.js';
/** Backtrace output cap: ~200 stack lines. */
export declare const MAX_BACKTRACE_LINES = 200;
/** Top memory categories kept in a meminfo summary. */
export declare const MAX_TOP_CATEGORIES = 12;
/** `dumpsys meminfo`/`package` outputs are small; ANR traces are not. */
export declare const DEBUG_MAX_BUFFER: number;
/** One running process as `ps -A` reports it. */
export interface AndroidProcess {
    pid: number;
    name: string;
}
/** One line of the `dumpsys meminfo` detail table. */
export interface MemoryCategory {
    name: string;
    /** Proportional set size in kilobytes. */
    pssKb: number;
}
/** Everything `parseMeminfo` can recover from one dump. */
export interface MeminfoFacts {
    pid?: number;
    /** TOTAL PSS in kilobytes — the number to watch over time. */
    totalPssKb: number;
    totalRssKb?: number;
    totalSwapPssKb?: number;
    javaHeapKb?: number;
    nativeHeapKb?: number;
    codeKb?: number;
    stackKb?: number;
    graphicsKb?: number;
    /** Largest mapping categories from the detail table, biggest first. */
    topCategories: MemoryCategory[];
}
/** Everything `parsePackageInfo` can recover from one `Package [...]` block. */
export interface PackageFacts {
    version?: string;
    versionCode?: number;
    minSdk?: number;
    targetSdk?: number;
    dataDir?: string;
    codePath?: string;
    firstInstallTime?: string;
    lastUpdateTime?: string;
    installerPackage?: string;
    system?: boolean;
}
/** `ps -A -o PID,NAME` → sorted processes. Throws on an unparseable dump. */
export declare function parseProcessTable(stdout: string): AndroidProcess[];
/**
 * Parse `dumpsys meminfo <pkg>`. Two tables matter: the detail table (one row
 * per mapping category, first numeric column = Pss Total) and the App Summary
 * block, which is the one worth reporting because it is already grouped the
 * way a developer thinks about memory.
 */
export declare function parseMeminfo(stdout: string): MeminfoFacts | undefined;
/**
 * Parse the `Package [<pkg>]` block of `dumpsys package <pkg>`. Returns
 * undefined when no such block exists, which is exactly the "not installed"
 * answer android_app_info reports as a fact rather than an error.
 */
export declare function parsePackageInfo(stdout: string, packageName: string): PackageFacts | undefined;
/**
 * Cap a stack dump. The interesting frames are at the TOP (the innermost
 * call), unlike a log tail — so this keeps the HEAD, not the tail.
 */
export declare function capBacktrace(lines: readonly string[], limit?: number): {
    lines: string[];
    truncated: boolean;
};
/** The first thread block of an ANR trace (usually "main"). */
export declare function firstThreadBlock(lines: readonly string[]): string[];
/**
 * Read the newest `/data/anr/` trace, when the shell user may. Returns
 * undefined for the (common) permission refusal so the caller can degrade to
 * the crash buffer and SAY that it did.
 */
export declare function readNewestAnrTrace(host: AndroidHostController, serial: string, timeoutMs: number): Promise<{
    path: string;
    lines: string[];
} | undefined>;
