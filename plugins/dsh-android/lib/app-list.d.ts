/**
 * Installed-app enumeration for dsh-android (`pm list packages` + a single
 * `dumpsys package packages` enrichment pass).
 *
 * Ported from dsh-ios app-list.ts, and it keeps that module's ONE hard
 * invariant: a FAILED listing THROWS. The measured failure it closes (WP57 on
 * the iOS side) was an agent that read an empty `xcrun devicectl` listing as
 * "the app is not installed", guessed a bundle id, and spent 377 s grepping
 * the user's source trees. `count: 0` must always be a fact about the DEVICE,
 * never about the plumbing, so an unparseable or non-zero-exit listing is an
 * error with the reason attached.
 *
 * What is different on Android:
 * - the identity is a PACKAGE NAME (`com.android.settings`), which `pm list
 *   packages` reports directly — there is no plist to decode;
 * - there is NO adb-visible display label. `aapt2` lives in the SDK, not on
 *   the device, and neither `pm` nor `dumpsys package` prints an app's
 *   `android:label`. So `label` mirrors the package name (the contract's
 *   "label 取不到就用包名") and every no-match hint says so out loud — a
 *   Chinese label read off the screen can never match a listing, and the model
 *   must be told the alternative instead of guessing a package name.
 * - versions come from ONE `dumpsys package packages` call (measured 0.15 s /
 *   790 KB on an Android 14 emulator), parsed host-side so the listing never
 *   depends on a device-side `grep`.
 * @module @zseven-w/dsh-android/app-list
 */
import type { AdbToolchain } from './adb.js';
/** One installed app, as the Android tools report it. */
export interface AndroidApp {
    /** The app's identity on Android — `com.android.settings`. */
    packageName: string;
    /**
     * Human-facing label. Android exposes no label over adb, so this is the
     * package name; see `ANDROID_LABEL_HINT`.
     */
    label: string;
    /** `versionName` from `dumpsys package`, when it reported one. */
    version?: string;
    /** `versionCode` from `dumpsys package`, when it reported one. */
    versionCode?: number;
    /** True for `pm list packages -s` (system/preinstalled) packages. */
    system: boolean;
    /** APK path, from `pm list packages -f`. */
    apkPath?: string;
}
/**
 * The Android-specific addendum to every no-match. On iOS this hint explains
 * that a phone reports base (English) names; on Android there are no names at
 * all over adb, which is a stronger statement and easier to get wrong — an
 * agent that matched "设置" against nothing must not conclude Settings is
 * missing.
 */
export declare const ANDROID_LABEL_HINT: string;
/**
 * Parse `pm list packages [-f]`: one `package:<name>` line per app, or
 * `package:<apk path>=<name>` with `-f`. The `=` split is done from the RIGHT
 * because an APK path can itself contain `=` (the install directory hash does:
 * `/data/app/~~rwUb…==/dev.rish.demo-Qx4…==/base.apk`).
 *
 * Output that is not a package listing at all — a `pm` diagnostic, an empty
 * capture, a permission refusal — THROWS: "the device has no apps" and "the
 * listing failed" must never look alike to the model.
 */
export declare function parsePmListPackages(stdout: string, serial?: string): {
    packageName: string;
    apkPath?: string;
}[];
/**
 * Parse the `Packages:` section of `dumpsys package packages` into
 * `packageName → { version, versionCode }`. Never throws: version enrichment
 * is a nicety, and a device whose dumpsys shape drifts must still list.
 */
export declare function parseDumpsysPackageVersions(stdout: string): Map<string, {
    version?: string;
    versionCode?: number;
}>;
/**
 * Enumerate the apps installed on one device.
 *
 * Three adb calls, in this order: the full listing (`pm list packages -f`),
 * the system set (`pm list packages -s`, so the default "user apps only" view
 * is correct), then ONE `dumpsys package packages` enrichment pass for
 * versions. The first two THROW on failure; the third is best-effort, because
 * a missing `versionName` is not a reason to hide an installed app.
 */
export declare function listAndroidApps(toolchain: AdbToolchain, serial: string, options?: {
    timeoutMs?: number;
}): Promise<AndroidApp[]>;
/** Filter + order one listing: user apps first, then by package name. */
export declare function filterAndroidApps(apps: readonly AndroidApp[], options?: {
    query?: string;
    includeSystem?: boolean;
}): AndroidApp[];
/** Up to `limit` package lines, user apps first, for a no-match hint. */
export declare function noMatchCandidateLines(apps: readonly AndroidApp[], limit?: number): string[];
/**
 * The `hint` a SUCCESSFUL listing attaches when a query matched nothing. A
 * bare `count: 0` gets read as "the app is not installed" (the exact misread
 * behind the iOS 377 s detour), so the result itself says WHICH empty shape
 * this is and carries the listed total as proof the listing worked.
 */
export declare function noMatchListingHint(listedTotal: number, includedSystem: boolean): string;
/**
 * Resolve a NAME to exactly one installed app: substring over package names
 * (and the label, which mirrors them), with an exact package match as the
 * tie-break — the same "exact first, then contains" rule android_tap_element
 * uses. Ambiguity and no-match both THROW, with the candidates or with the
 * verb to run, because guessing a package name is the failure this closes.
 */
export declare function resolveAppByName(tool: string, apps: readonly AndroidApp[], name: string, deviceName: string): AndroidApp;
