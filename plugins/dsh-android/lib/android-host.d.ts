/**
 * Host-side lifecycle manager for the one live Android device stream.
 *
 * The dsh-ios twin (sim-host.ts) manages an EXTERNAL serve-sim child with
 * orphan adoption, port ranges and handshake reconciliation; none of that
 * exists here because the stream is in-process (frame-source.ts): one
 * AdbFrameLoop per streamed serial, a consumer refcount with an idle
 * timeout, and a keep-alive that restarts a crashed loop. Emulators and
 * physical devices share this path — the serial is the only identity
 * (docs/architecture.zh.md, decision 0).
 *
 * The control surface mirrors dsh-ios's `StreamControl` contract: normalized
 * 0..1 coordinates of the streamed frame, mapped onto `adb shell input`
 * pixels using the latest frame's own size (the frame and the input space
 * are both the live display space, so one mapping serves every rotation).
 * @module @zseven-w/dsh-android/android-host
 */
import { AdbToolchain, type AndroidDevice } from './adb.js';
import { type DeviceFrame } from './frame-source.js';
/** Navigation/hardware buttons the panel and tools may press. */
export declare const ANDROID_BUTTONS: {
    readonly home: "KEYCODE_HOME";
    readonly back: "KEYCODE_BACK";
    readonly recents: "KEYCODE_APP_SWITCH";
    readonly power: "KEYCODE_POWER";
    readonly volume_up: "KEYCODE_VOLUME_UP";
    readonly volume_down: "KEYCODE_VOLUME_DOWN";
    readonly menu: "KEYCODE_MENU";
    readonly enter: "KEYCODE_ENTER";
    readonly delete: "KEYCODE_DEL";
};
export type AndroidButton = keyof typeof ANDROID_BUTTONS;
/**
 * Device-level actions beyond plain touches. Everything here is a plain adb
 * verb, so unlike dsh-ios there is no per-backend delivery table — the only
 * split is that `shake` needs the emulator console and is refused elsewhere.
 */
export declare const ANDROID_DEVICE_ACTIONS: readonly ["notifications", "quick-settings", "lock", "wake", "assistant"];
export type AndroidDeviceAction = (typeof ANDROID_DEVICE_ACTIONS)[number];
export declare function isAndroidDeviceAction(value: unknown): value is AndroidDeviceAction;
/** Clockwise user_rotation cycle (Surface.ROTATION_0..270). */
export declare const ROTATION_CYCLE: readonly [0, 1, 2, 3];
export interface AndroidStreamInfo {
    serial: string;
    /** Latest frame pixel size, once at least one frame arrived. */
    width?: number;
    height?: number;
}
export interface AndroidHostStatus {
    available: boolean;
    running: boolean;
    serial?: string;
    startedAt?: number;
    restarts: number;
    lastError?: string;
    adbSource: string;
    adbCommand?: string;
    consumers: number;
    frameSequence?: number;
    lastFrameAt?: number;
    width?: number;
    height?: number;
    stderr: string[];
}
export interface AndroidHostOptions {
    restartDelayMs?: number;
    idleTimeoutMs?: number;
    firstFrameTimeoutMs?: number;
}
export interface AndroidDrag {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    /** Gesture duration in seconds (default 0.3). */
    duration?: number;
}
/**
 * Escape one text argument for `input text`: the device-side parser expands
 * `%s` to a space and chokes on shell metacharacters, so everything unsafe
 * is escaped and spaces become `%s`. Callers gate non-ASCII beforehand.
 */
export declare function escapeInputText(text: string): string;
/** True when `input text` can deliver the string (it is ASCII-only). */
export declare function isInputTextSafe(text: string): boolean;
export declare const NON_ASCII_TYPE_HINT: string;
/** Lifecycle manager for the (single) in-process Android device stream. */
export declare class AndroidHostController {
    #private;
    readonly toolchain: AdbToolchain;
    constructor(toolchain?: AdbToolchain, options?: AndroidHostOptions);
    get available(): boolean;
    get running(): boolean;
    /** The streamed serial, when a loop is live. */
    get streamedSerial(): string | undefined;
    get latestFrame(): DeviceFrame | undefined;
    /** Observe every decoded frame; the returned function unsubscribes. */
    subscribeFrames(subscriber: (frame: DeviceFrame) => void): () => void;
    /**
     * Make sure the frame loop is live for `serial`. Concurrent callers share
     * one launch; a call for a different serial retires the current loop first
     * (one streamed device at a time, same slot semantics as dsh-ios).
     */
    ensureStreaming({ serial }: {
        serial: string;
    }): Promise<AndroidStreamInfo>;
    /** Start the crash keep-alive loop (restarts an unintentionally dead loop). */
    startKeepAlive(): void;
    stopKeepAlive(): void;
    /** Stop the stream intentionally (keep-alive will not fight it). */
    stop(): Promise<void>;
    /** Hold the stream alive for one consumer; release exactly once. */
    acquire(): () => void;
    status(): AndroidHostStatus;
    dispose(): Promise<void>;
    /** Tap at normalized coordinates of the streamed frame. */
    tap(serial: string, x: number, y: number): Promise<void>;
    /** Drag between normalized coordinates (`input swipe` with duration). */
    drag(serial: string, drag: AndroidDrag): Promise<void>;
    /** Press a navigation/hardware button by panel name or raw KEYCODE_*. */
    button(serial: string, name?: string): Promise<void>;
    /**
     * Type text into the focused element. ASCII goes through `input text`;
     * non-ASCII (CJK, emoji) is attempted through the ADBKeyboard IME when it
     * is installed, otherwise refused with the install hint — never silently
     * mistyped.
     */
    type(serial: string, text: string): Promise<void>;
    /** Force the display rotation (Surface.ROTATION_0..3). */
    rotate(serial: string, rotation: number): Promise<void>;
    /** The current user_rotation (0..3), defaulting to 0 when unreadable. */
    getRotation(serial: string): Promise<number>;
    /** Run one device-level action (notification shade, lock, wake, …). */
    deviceAction(serial: string, action: AndroidDeviceAction): Promise<void>;
    /** Capture a fresh PNG of the device (independent of the stream loop). */
    screenshot(serial: string): Promise<{
        png: Buffer;
        width?: number;
        height?: number;
    }>;
    /** Resolve one online device: explicit serial, streamed, or the only one. */
    resolveTarget(serial?: string): Promise<AndroidDevice>;
}
/** Stable fallback used by routes and legacy calls that have no agent session. */
export declare const DEFAULT_ANDROID_STREAM_SCOPE = "default";
/**
 * Session-aware collection of independent Android stream controllers.
 *
 * A controller still owns exactly one serial and one frame loop, preserving the
 * well-tested single-stream lifecycle above. The registry supplies one such
 * controller per Harness session, so two conversations can keep two emulators
 * alive concurrently without sharing panel state or switching each other.
 */
export declare class AndroidHostRegistry {
    #private;
    readonly toolchain: AdbToolchain;
    constructor(toolchain?: AdbToolchain, options?: AndroidHostOptions);
    hostFor(scope?: string): AndroidHostController;
    /** Existing controller for a scope without creating a new idle entry. */
    existing(scope?: string): AndroidHostController | undefined;
    /** The first live controller for a serial (used by signed stream URLs). */
    streamingHostForSerial(serial: string): AndroidHostController | undefined;
    /** Serials currently streamed in any conversation. */
    streamedSerials(): Set<string>;
    /** Stop every session currently bound to a serial. */
    stopSerial(serial: string): Promise<void>;
    status(scope?: string): AndroidHostStatus;
    dispose(): Promise<void>;
}
