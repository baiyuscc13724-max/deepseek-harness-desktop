/**
 * Model-facing core tools for the Android plugin (adb-centric, see
 * docs/architecture.zh.md decision 0).
 *
 * Every tool returns plain JSON — never an image content block, because the
 * DeepSeek adapter rejects image blocks anywhere in a request. Visual bytes
 * reach the UI only through `output.presentationMeta`, which projects pure,
 * replayable data (device serial, screenshot file path, stable stream route
 * id); the client/web-route layer re-mints signed access at render time.
 *
 * Degradation mirrors dsh-ios: the tools ALWAYS register, and each `execute`
 * throws a clear explanatory error when adb is unresolvable — a machine
 * without the Android SDK must load the plugin and be told why, not silently
 * lose eight verbs.
 *
 * Emulators and physical devices share ONE code path here. adb does not
 * distinguish them and neither do we, so there is no dsh-ios-style
 * simulator/real-device split, no WebDriverAgent gate, and no second listing.
 *
 * This module owns the five device/stream verbs; the three app-lifecycle
 * verbs live in `tool-apps.ts` (the 800-line file rule) and the shared
 * runtime in `tool-support.ts`. Both are re-exported here, so `./tools.js`
 * stays the one import path the sibling tool families use.
 * @module @zseven-w/dsh-android/tools
 */
import { type ToolDefinition } from '@deepseek-ai/dsh-tools';
import { AndroidHostRegistry, type AndroidHostController } from './android-host.js';
import { type AndroidDeviceInfo, type AndroidInteractAction, type AndroidScreenshotResult } from './tool-support.js';
import { type AndroidVisionServices } from './vision.js';
export * from './tool-support.js';
export * from './tool-apps.js';
/** Registered tool names, in registration order. */
export declare const ANDROID_TOOL_NAMES: readonly ["android_devices", "android_boot", "android_shutdown", "android_screenshot", "android_interact", "android_list_apps", "android_launch_app", "android_build_run"];
/** One row of `android_devices`. */
export interface AndroidDeviceListing extends AndroidDeviceInfo {
    /** Emulators and phones both stream; the kind is informational. */
    kind: 'emulator' | 'physical';
    model?: string;
    product?: string;
    sdk?: number;
    /** AVD name, when the emulator console answered. */
    avdName?: string;
    /** True for the device the panel is currently streaming. */
    streaming?: boolean;
}
export interface AndroidDevicesResult {
    devices: AndroidDeviceListing[];
    count: number;
    /** Serials in the fully-online `device` state. */
    online: string[];
    /** AVD names this machine can boot with android_boot (may be empty). */
    avds: string[];
    /** Set when AVD discovery failed; the device list is still authoritative. */
    note?: string;
}
export interface AndroidBootResult {
    device: AndroidDeviceInfo;
    state: 'streaming';
    streaming: true;
    /** True when an AVD was launched (rather than an online device adopted). */
    booted: boolean;
}
export interface AndroidShutdownResult {
    device: AndroidDeviceInfo;
    state: 'shutdown';
    streaming: false;
}
export interface AndroidInteractResult extends AndroidScreenshotResult {
    action: AndroidInteractAction;
}
export interface AndroidToolsOptions {
    /** Plugin-owned cache root (default `<tmp>/dsh-android`). */
    cacheDir?: string;
    /** Optional attachments+llm services for native image delivery. */
    vision?: AndroidVisionServices;
}
/** The eight core tool definitions bound to one host controller. */
export interface AndroidTools {
    androidDevices: ToolDefinition;
    androidBoot: ToolDefinition;
    androidShutdown: ToolDefinition;
    androidScreenshot: ToolDefinition;
    androidInteract: ToolDefinition;
    androidListApps: ToolDefinition;
    androidLaunchApp: ToolDefinition;
    androidBuildRun: ToolDefinition;
}
export type AndroidHostSource = AndroidHostController | AndroidHostRegistry;
/** Create the eight `android_*` core tool definitions bound to session-aware hosts. */
export declare function createAndroidTools(host: AndroidHostSource, options?: AndroidToolsOptions): AndroidTools;
