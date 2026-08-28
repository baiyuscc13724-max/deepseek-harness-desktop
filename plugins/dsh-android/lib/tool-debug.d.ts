/**
 * Debugging & memory diagnostics for the Android plugin: processes, stack
 * dumps, memory, and package facts.
 *
 * The dsh-ios twin drives lldb/leaks/sample on a Mac-hosted simulator. None of
 * that has an adb equivalent an unprivileged shell can reach, so the honesty
 * rule from that module is the load-bearing part here: every result NAMES the
 * engine that produced it and what that engine cannot see. An agent that reads
 * an empty backtrace as "the app has no stack" is the failure this closes.
 *
 * - `android_processes` — `ps -A -o PID,NAME`, filtered.
 * - `android_backtrace` — `kill -3 <pid>` asks ART to dump every thread's
 *   stack into `/data/anr/`. The adb shell user (uid 2000) may send the signal
 *   only to processes it can signal, and `/data/anr` is `system:system 0770`,
 *   so on a production phone BOTH steps usually fail. The tool then degrades
 *   to the `crash` log buffer and says so in `engine`, rather than returning
 *   an empty stack that reads like "no crash happened".
 * - `android_meminfo` — `dumpsys meminfo <pkg>`: TOTAL PSS plus the App
 *   Summary categories. The counterpart of ios_sim_leaks's summary mode.
 * - `android_app_info` — `dumpsys package <pkg>`. A package that is NOT
 *   installed is a normal answer (`installed:false` + a note), not an error:
 *   the caller asked a question and got a fact.
 * @module @zseven-w/dsh-android/tool-debug
 */
import { type ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { AndroidHostController } from './android-host.js';
import { type AndroidProcess, type MemoryCategory } from './debug-parse.js';
import type { AndroidDeviceInfo } from './tools.js';
export { capBacktrace, parseMeminfo, parsePackageInfo, parseProcessTable, type AndroidProcess, type MemoryCategory, } from './debug-parse.js';
/** Registered tool names, in registration order. */
export declare const ANDROID_DEBUG_TOOL_NAMES: readonly ["android_processes", "android_backtrace", "android_meminfo", "android_app_info"];
/** How a backtrace was actually produced — never implied, always reported. */
export type BacktraceEngine = 'anr-trace' | 'logcat-crash';
export interface AndroidDebugToolsOptions {
    /** Plugin-owned cache root (accepted for symmetry; nothing is written yet). */
    cacheDir?: string;
    /** Hard deadline for one debug round trip (default 60000 ms, min 1000). */
    timeoutMs?: number;
}
export interface AndroidProcessesResult {
    device: AndroidDeviceInfo;
    count: number;
    processes: AndroidProcess[];
    /** Set when a filter matched nothing, explaining what was searched. */
    hint?: string;
}
export interface AndroidBacktraceResult {
    device: AndroidDeviceInfo;
    /** Pid the dump was requested for, when one was resolved. */
    pid?: number;
    packageName?: string;
    /** Which mechanism produced `lines` — read this before trusting them. */
    engine: BacktraceEngine;
    allThreads: boolean;
    lineCount: number;
    truncated: boolean;
    lines: string[];
    /** ANR trace file the dump was read from, when one was readable. */
    tracePath?: string;
    /** What the engine could NOT do (permission, missing trace, …). */
    note?: string;
}
export interface AndroidMeminfoResult {
    device: AndroidDeviceInfo;
    packageName: string;
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
    /** Set when the process was not running or the dump was partial. */
    note?: string;
}
export interface AndroidAppInfoResult {
    device: AndroidDeviceInfo;
    packageName: string;
    installed: boolean;
    version?: string;
    versionCode?: number;
    minSdk?: number;
    targetSdk?: number;
    /** Writable data directory (`/data/user/0/<pkg>`). */
    dataDir?: string;
    /** Installed APK directory. */
    codePath?: string;
    firstInstallTime?: string;
    lastUpdateTime?: string;
    /** Which installer recorded the package (`com.android.vending`, `null`, …). */
    installerPackage?: string;
    /** True for a preinstalled/system package. */
    system?: boolean;
    /** True when the package is currently running. */
    running?: boolean;
    pid?: number;
    /** Set when the package is NOT installed: what to run instead of guessing. */
    note?: string;
}
/** The four debug tool definitions bound to one host controller. */
export interface AndroidDebugTools {
    androidProcesses: ToolDefinition;
    androidBacktrace: ToolDefinition;
    androidMeminfo: ToolDefinition;
    androidAppInfo: ToolDefinition;
    /** Abandon anything still in flight (mirrors the dsh-ios debug contract). */
    dispose(): void;
}
/** Create the four `android_*` debug tool definitions bound to one host. */
export declare function createAndroidDebugTools(host: AndroidHostController, options?: AndroidDebugToolsOptions): AndroidDebugTools;
