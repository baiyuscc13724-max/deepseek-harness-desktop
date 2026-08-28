/**
 * adb toolchain resolution and device-facing primitives for dsh-android.
 *
 * Design rule (see docs/architecture.zh.md, decision 0): the plugin is
 * adb-centric. A device's one and only identity is the SERIAL that
 * `adb devices -l` reports — emulators, USB phones and `ip:port` devices all
 * share the same code path. Nothing in this module assumes a particular
 * emulator product; the `emulator` binary is a best-effort optional discovery
 * used solely by the boot-an-AVD verb, and every other verb keeps working
 * without it.
 *
 * adb discovery order: `ADB` env var → PATH → the usual SDK locations
 * (`ANDROID_HOME` / `ANDROID_SDK_ROOT` / per-OS defaults). When nothing
 * resolves the plugin still loads and registers its tools; each call then
 * fails with an explanatory error (the same degradation style dsh-ios uses on
 * non-macOS hosts).
 * @module @zseven-w/dsh-android/adb
 */
import { type ChildProcess } from 'node:child_process';
export declare const DEFAULT_BOOT_TIMEOUT_MS = 180000;
/** Failure of one adb (or emulator) invocation, with the args that ran. */
export declare class AdbError extends Error {
    readonly args: readonly string[];
    readonly stderr: string;
    readonly exitCode: number | null;
    constructor(message: string, args: readonly string[], stderr?: string, exitCode?: number | null);
}
export type AdbBinarySource = 'env' | 'path' | 'sdk' | 'unavailable';
/** How adb is launched: env override, PATH hit, SDK default, or not at all. */
export interface AdbBinary {
    available: boolean;
    source: AdbBinarySource;
    /** Absolute path of the adb executable when available. */
    command?: string;
    /** Why adb is unavailable. */
    reason?: string;
}
/** `adb devices -l` connection states this module distinguishes. */
export type AdbDeviceState = 'device' | 'offline' | 'unauthorized' | 'recovery' | 'sideload' | 'unknown';
/** One row of `adb devices -l`, plus what the serial itself reveals. */
export interface AndroidDevice {
    serial: string;
    state: AdbDeviceState;
    /** True for `emulator-<port>` serials (and goldfish/ranchu products). */
    emulator: boolean;
    /** Trailing `key:value` fields of the listing row (model, product, …). */
    model?: string;
    product?: string;
    transportId?: string;
}
/** getprop-backed details of one online device. */
export interface AndroidDeviceDetails {
    serial: string;
    model?: string;
    manufacturer?: string;
    /** Human Android version (`ro.build.version.release`). */
    androidVersion?: string;
    /** API level (`ro.build.version.sdk`). */
    sdk?: number;
    /** The AVD name for an emulator, when the console answers. */
    avdName?: string;
}
/**
 * Resolve how to launch adb:
 * 1. an explicit `ADB` env var pointing at the executable;
 * 2. `adb` on PATH;
 * 3. `<sdk-root>/platform-tools/adb` for the usual SDK roots.
 */
export declare function resolveAdbBinary(): AdbBinary;
/**
 * Best-effort discovery of the `emulator` launcher, used ONLY by the
 * boot-an-AVD verb. Order: SDK roots → derived from the adb location
 * (`<sdk>/platform-tools/adb` → `<sdk>/emulator/emulator`) → PATH. Every
 * other verb works without it — machines differ in which emulator product
 * (if any) they have installed, and adb is the only contract.
 */
export declare function resolveEmulatorBinary(adb?: AdbBinary): {
    available: boolean;
    command?: string;
    reason?: string;
};
export interface ExecOptions {
    /** Target device serial (`adb -s <serial> …`). */
    serial?: string;
    timeoutMs?: number;
    maxBuffer?: number;
}
/** One resolved adb toolchain with exec/spawn helpers bound to it. */
export declare class AdbToolchain {
    readonly binary: AdbBinary;
    constructor(binary?: AdbBinary);
    get available(): boolean;
    /** Throw the explanatory unavailable error tools surface verbatim. */
    requireAdb(): string;
    /** Run `adb [-s serial] <args…>` and collect text output. */
    exec(args: readonly string[], options?: ExecOptions): Promise<{
        stdout: string;
        stderr: string;
    }>;
    /**
     * Run `adb -s <serial> exec-out <command…>` and collect BINARY stdout.
     * exec-out skips the pty so PNG bytes (screencap) survive unmangled.
     */
    execOut(serial: string, command: readonly string[], options?: {
        timeoutMs?: number;
        maxBuffer?: number;
    }): Promise<Buffer>;
    /** Run `adb -s <serial> shell <command…>` and return trimmed stdout. */
    shell(serial: string, command: readonly string[], options?: {
        timeoutMs?: number;
        maxBuffer?: number;
    }): Promise<string>;
    /** Spawn a long-lived `adb -s <serial> exec-out <command…>` child. */
    spawnExecOut(serial: string, command: readonly string[]): ChildProcess;
    /** Parse `adb devices -l` (skips the header and daemon-start noise). */
    listDevices(): Promise<AndroidDevice[]>;
    /** Devices in the `device` (fully online) state. */
    onlineDevices(): Promise<AndroidDevice[]>;
    /** getprop-backed details; every field is best-effort. */
    deviceDetails(device: AndroidDevice): Promise<AndroidDeviceDetails>;
    /**
     * The device screen size in pixels, from `wm size`. An override (what apps
     * actually render at) wins over the physical panel size.
     */
    screenSize(serial: string): Promise<{
        width: number;
        height: number;
    }>;
    /** Poll `sys.boot_completed` until the device finishes booting. */
    waitForBoot(serial: string, timeoutMs?: number): Promise<void>;
}
/** Serial pattern accepted by routes/tools (`emulator-5554`, USB, ip:port). */
export declare const SERIAL_PATTERN: RegExp;
/** List the machine's AVD names, when an emulator launcher is discoverable. */
export declare function listAvds(): Promise<string[]>;
/**
 * Launch one AVD detached and resolve the serial adb assigns it. The
 * launcher process is deliberately NOT owned or reaped by the plugin: an
 * emulator the user boots through us should outlive the conversation, the
 * same way a hand-booted one would (adb, not the launcher, is the contract).
 */
export declare function bootAvd(toolchain: AdbToolchain, avdName: string, options?: {
    timeoutMs?: number;
    extraArgs?: readonly string[];
}): Promise<{
    serial: string;
}>;
