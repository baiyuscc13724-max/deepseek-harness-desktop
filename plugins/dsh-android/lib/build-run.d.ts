/**
 * Gradle pipeline for `android_build_run`: detect the project, run
 * `assembleDebug`, locate the produced APK, resolve its applicationId,
 * install it with `adb install -r`, and launch it with `monkey`.
 *
 * The dsh-ios twin drives `xcodebuild`; the shape is deliberately the same
 * (detect → build → find artifact → read the id → install → launch, with the
 * FILTERED build tail attached to every failure) so the two plugins fail the
 * same way. What differs is Android-specific:
 *
 * - the wrapper wins. `./gradlew` pins the Gradle version a project was
 *   written against; a PATH `gradle` of the wrong major routinely fails with
 *   an unrelated plugin error, so the wrapper is preferred and the PATH
 *   binary is only the fallback.
 * - the applicationId is NOT the module name and NOT guessable. It is read
 *   from `build/outputs/apk/debug/output-metadata.json` (AGP writes it next to
 *   the APK), then from `applicationId "…"` in the module's build script, and
 *   only then from `package="…"` in a legacy `AndroidManifest.xml`. `aapt2
 *   dump badging` is deliberately not used: it lives in a versioned
 *   `build-tools/<version>/` directory that is not on PATH on most machines.
 * @module @zseven-w/dsh-android/build-run
 */
import type { AdbToolchain, AndroidDevice } from './adb.js';
/** A detected, buildable Gradle project on disk. */
export interface AndroidProject {
    /** Directory the build runs in (the Gradle root). */
    root: string;
    /** Absolute `gradlew` path, or the PATH command name. */
    gradleCommand: string;
    /** Where `gradleCommand` came from — the wrapper is always preferred. */
    gradleSource: 'wrapper' | 'path';
    /** The settings/build script that identified the root. */
    buildFile: string;
}
/** Successful outcome of build + install + launch. */
export interface AndroidBuildRunResult {
    device: {
        serial: string;
        name: string;
        androidVersion: string;
        state: string;
    };
    state: 'launched';
    packageName: string;
    apkPath: string;
    projectPath: string;
    /** Gradle task that ran, e.g. `assembleDebug` or `:app:assembleDebug`. */
    task: string;
    variant: string;
    /** Where the applicationId came from — never a guess. */
    packageSource: 'output-metadata' | 'build-script' | 'manifest';
    /** True when a running instance was force-stopped before the launch. */
    relaunched?: boolean;
}
/**
 * Detect the Gradle project at `projectPath` and how to build it.
 *
 * `projectPath` may be the Gradle root, or a module directory inside one (the
 * usual `…/app`): a module's own `build.gradle` cannot be built on its own, so
 * the walk climbs to the nearest ancestor carrying `settings.gradle[.kts]`.
 * The wrapper found at that root wins over any PATH `gradle`.
 */
export declare function detectProject(projectPath: string): AndroidProject;
/**
 * The Gradle task for one variant, optionally scoped to a module:
 * `assembleDebug` or `:app:assembleDebug`. `variant` is capitalized because
 * Gradle's task names are `assemble<Variant>`.
 */
export declare function assembleTask(variant: string, module?: string): string;
/** The argument vector handed to Gradle. Exported for dry-run verification. */
export declare function assembleGradleArgs(task: string, extraArgs?: readonly string[]): string[];
/** Run one Gradle invocation, keeping the last OUTPUT_TAIL_LINES lines. */
export declare function runGradleBuild(project: AndroidProject, args: readonly string[], signal: AbortSignal): Promise<{
    exitCode: number | null;
    lines: string[];
}>;
/**
 * Reduce Gradle output to the last ~80 informative lines: drop blanks and the
 * progress boilerplate above, keep `e: file.kt:12:3: …` compiler diagnostics,
 * `FAILURE:` blocks and `* What went wrong:` sections.
 */
export declare function filterBuildOutput(lines: readonly string[], limit?: number): string[];
/** Tail of build output embedded in the thrown failure message. */
export declare function buildFailureDetail(lines: readonly string[]): string;
/** One APK found under a `build/outputs/apk/<variant>` directory. */
export interface BuiltApk {
    path: string;
    /** The `build/outputs/apk/<variant>` directory it was found in. */
    outputDir: string;
    mtimeMs: number;
}
/**
 * Locate the freshly built APK: every `build/outputs/apk/<variant>/*.apk`
 * below the project root, newest mtime first.
 *
 * The walk is bounded (depth 5, skipping `.git`/`.gradle`/`src`/…) because a
 * monorepo root can hold thousands of directories, and a full walk of one was
 * never the point — AGP always writes to that exact path.
 */
export declare function findBuiltApk(root: string, variant?: string): BuiltApk | undefined;
/** The applicationId plus where it was read from — never a guess. */
export interface ResolvedApplicationId {
    packageName: string;
    source: AndroidBuildRunResult['packageSource'];
}
/**
 * Read the applicationId AGP recorded next to the APK
 * (`output-metadata.json`). This is the authoritative source: it is written by
 * the same build that produced the APK, so flavour/suffix rules are already
 * applied (`dev.rish.demo.debug`, not `dev.rish.demo`).
 */
export declare function applicationIdFromOutputMetadata(outputDir: string): string | undefined;
/**
 * Fallback: `applicationId "…"` / `applicationId = "…"` from a module's build
 * script, or `package="…"` from a legacy `AndroidManifest.xml`. Both are
 * searched from the APK's module directory upward, so the right module wins in
 * a multi-module project.
 */
export declare function applicationIdFromSources(moduleDir: string, root: string): ResolvedApplicationId | undefined;
/**
 * The module directory an APK belongs to: `<module>/build/outputs/apk/…` walks
 * back up to `<module>`.
 */
export declare function moduleDirectoryOf(apkPath: string): string;
/** Resolve the applicationId of a built APK, or throw with what to do next. */
export declare function resolveApplicationId(apk: BuiltApk, root: string): ResolvedApplicationId;
export interface BuildRunOptions {
    project: AndroidProject;
    toolchain: AdbToolchain;
    device: AndroidDevice;
    /** Device summary carried into the result (model/version already resolved). */
    deviceSummary: AndroidBuildRunResult['device'];
    /** Gradle module path, e.g. `app` or `:app` (omit to build every module). */
    module?: string;
    /** Build variant; `debug` unless the caller asks otherwise. */
    variant?: string;
    /** Force-stop a running instance before launching. */
    relaunch?: boolean;
    signal: AbortSignal;
}
/**
 * Full pipeline: gradle assemble → find the APK → read the applicationId →
 * `adb install -r` → `monkey` launch. Every failure carries the filtered
 * Gradle tail (build) or the adb stderr (install/launch), because "it failed"
 * with no output is what turns one tool call into a shell session.
 */
export declare function buildRun(options: BuildRunOptions): Promise<AndroidBuildRunResult>;
/**
 * Launch a package's launcher activity. `monkey -p <pkg> 1` is used rather
 * than `am start -n <pkg>/<activity>` because the launcher activity's class
 * name is not knowable without reading the manifest off the device; monkey
 * resolves the LAUNCHER intent itself. Its "no activities found" answer is
 * printed on stdout with exit code 0, so the output is inspected.
 */
export declare function launchPackage(toolchain: AdbToolchain, serial: string, packageName: string): Promise<void>;
/** True when `path` looks like an installable APK on disk. */
export declare function isApkFile(path: string): boolean;
/** Re-exported for the smoke: the directories the APK search refuses to walk. */
export declare const APK_SEARCH_SKIPPED_DIRECTORIES: readonly string[];
