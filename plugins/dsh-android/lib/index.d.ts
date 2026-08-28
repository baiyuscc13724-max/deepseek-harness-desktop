/**
 * @zseven-w/dsh-android — build, run, and interact with a live Android device
 * inside a DeepSeek Harness conversation, driven entirely through adb.
 *
 * Plugin lifecycle: one AndroidHostController owns the in-process frame loop
 * for the session (no serve-sim child, no internal port — see
 * docs/architecture.zh.md decision 1); twenty model-facing tools are
 * registered through `ctx.effect` so unloading the plugin unregisters them,
 * and the returned disposer stops the stream, the keep-alive loop, and any
 * debug work still in flight.
 *
 * Emulators and physical devices are the SAME target here: the adb serial is
 * the only identity, so there is no dsh-ios-style simulator/real-device split
 * anywhere in this file.
 *
 * On a host without adb the tools still register but fail with a clear
 * explanatory error — the same degradation style dsh-ios uses on non-macOS.
 * @module @zseven-w/dsh-android
 */
import type { Context } from '@deepseek-ai/cordis';
export { AdbError, AdbToolchain, DEFAULT_BOOT_TIMEOUT_MS, SERIAL_PATTERN, bootAvd, listAvds, resolveAdbBinary, resolveEmulatorBinary, type AdbBinary, type AdbBinarySource, type AdbDeviceState, type AndroidDevice, type AndroidDeviceDetails, type ExecOptions, } from './adb.js';
export { AdbFrameLoop, MultipartFrameWriter, PngFrameSplitter, STREAM_BOUNDARY, pngDimensions, type DeviceFrame, type FrameLoopEvents, } from './frame-source.js';
export { ANDROID_BUTTONS, ANDROID_DEVICE_ACTIONS, DEFAULT_ANDROID_STREAM_SCOPE, AndroidHostController, AndroidHostRegistry, NON_ASCII_TYPE_HINT, ROTATION_CYCLE, escapeInputText, isAndroidDeviceAction, isInputTextSafe, type AndroidButton, type AndroidDeviceAction, type AndroidDrag, type AndroidHostOptions, type AndroidHostStatus, type AndroidStreamInfo, } from './android-host.js';
export { StreamAccessController, TOKEN_TTL_MS, classifyScreenshotPath, isLoopbackRemoteAddress, isTrustedRequest, openVerifiedScreenshot, prepareStreamAccessKey, screenshotDir, stateRoot, type ScreenshotTokenPayload, type ScreenshotVerdict, type StreamTokenPayload, } from './stream-access.js';
export { CAPTURE_ROUTE_PATH, CONTROL_ROUTE_PATH, DEVICES_ROUTE_PATH, DEVICE_ACTION_ROUTE_PATH, GRANT_ROUTE_PATH, PLUGIN_ROUTE_PREFIX, SCREENSHOT_ROUTE_PREFIX, STATUS_ROUTE_PATH, STREAM_ROUTE_PREFIX, SWITCH_DEVICE_ROUTE_PATH, StreamRoutes, deviceStateErrorCode, installStreamRoutes, mountStreamRoutes, nextCapturePath, type AndroidRouteErrorCode, type StreamRouteMount, } from './stream-routes.js';
export { ANDROID_LABEL_HINT, filterAndroidApps, listAndroidApps, noMatchCandidateLines, noMatchListingHint, parseDumpsysPackageVersions, parsePmListPackages, resolveAppByName, type AndroidApp, } from './app-list.js';
export { APK_SEARCH_SKIPPED_DIRECTORIES, applicationIdFromOutputMetadata, applicationIdFromSources, assembleGradleArgs, assembleTask, buildFailureDetail, buildRun, detectProject, filterBuildOutput, findBuiltApk, isApkFile, launchPackage, moduleDirectoryOf, resolveApplicationId, runGradleBuild, type AndroidBuildRunResult, type AndroidProject, type BuildRunOptions, type BuiltApk, type ResolvedApplicationId, } from './build-run.js';
/**
 * The core tool layer. `./tools.js` re-exports `./tool-support.js` (device
 * resolution, the shared ScreenshotStore, the interaction router) and
 * `./tool-apps.js` (list/launch/build-run), so one star export carries the
 * whole surface without listing it twice.
 */
export * from './tools.js';
export { ANDROID_UI_TOOL_NAMES, createAndroidUiTools, type AndroidToolHost, type AndroidUiTools, type AndroidUiToolsOptions, } from './tool-uitree.js';
export { ANDROID_OCR_TOOL_NAMES, createAndroidOcrTools, type AndroidOcrTools, } from './tool-ocr.js';
export { ANDROID_ROW_TOOL_NAMES, createAndroidRowTools, type AndroidRowTools, } from './tool-list-rows.js';
export { LOG_BUFFERS, LOG_PRIORITIES, LogLineRing, MAX_LOG_BYTES, MAX_LOG_LINES, compileGrep, createAndroidLogTools, deviceStartTimestamp, durationSeconds, followSeconds, postProcess, resolvePackagePid, runLogCapture, snapshotDuration, type AndroidLogBuffer, type AndroidLogPriority, type AndroidLogTools, type AndroidLogsArgs, type AndroidLogsMode, type AndroidLogsResult, } from './tool-logs.js';
export { ANDROID_DEBUG_TOOL_NAMES, capBacktrace, createAndroidDebugTools, parseMeminfo, parsePackageInfo, parseProcessTable, type AndroidAppInfoResult, type AndroidBacktraceResult, type AndroidDebugTools, type AndroidDebugToolsOptions, type AndroidMeminfoResult, type AndroidProcess, type AndroidProcessesResult, type BacktraceEngine, type MemoryCategory, } from './tool-debug.js';
export { ANDROID_SKILL_CONTENT, ANDROID_SKILL_DESCRIPTION, ANDROID_SKILL_NAME, ANDROID_SKILL_WHEN_TO_USE, registerAndroidSkill, } from './skill.js';
/** Stable plugin name (the loader entry id in cordis.patch.yml). */
export { IMAGE_REF_SCHEMA, imageInputActive, renderJsonWithImage, resolveVisionServices, saveScreenshotAttachment, type AndroidImageRef, type AndroidVisionServices, type AttachmentStoreLike, type LlmServiceLike, type VisionExecLike, } from './vision.js';
export declare const name = "dsh-android";
/** Services this plugin's root fiber requires. */
export declare const inject: string[];
/** Plugin entry: mount every model-facing contribution. */
export declare function apply(ctx: Context): () => Promise<void>;
