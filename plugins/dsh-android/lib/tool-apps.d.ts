/**
 * The app-lifecycle third of the core tool set: `android_list_apps`,
 * `android_launch_app`, `android_build_run`.
 *
 * Split out of tools.ts purely for the 800-line file rule; `createAndroidTools`
 * composes these three with the five device/stream tools and the whole set is
 * still one factory to the plugin. The enumeration/launch verbs live together
 * because they share one invariant: a package name is NEVER guessed — it is
 * listed (`app-list.ts`), resolved by fragment, or read out of the build AGP
 * just produced (`build-run.ts`).
 * @module @zseven-w/dsh-android/tool-apps
 */
import { type ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { AndroidHostController } from './android-host.js';
import { type AndroidApp } from './app-list.js';
import { type AndroidDeviceInfo } from './tool-support.js';
export interface AndroidListAppsResult {
    device: AndroidDeviceInfo;
    count: number;
    apps: AndroidApp[];
    /** Package lines from the SAME listing when a query matched nothing. */
    candidates?: string[];
    /** Why the query matched nothing on a SUCCESSFUL listing. */
    hint?: string;
}
export interface AndroidLaunchAppResult {
    device: AndroidDeviceInfo;
    packageName: string;
    launched: true;
    /** Set when the call resolved a `name` fragment instead of a package. */
    matched?: string;
    /** Whether a running instance was force-stopped first. */
    relaunched?: boolean;
}
/** The three app-lifecycle tool definitions. */
export interface AndroidAppTools {
    androidListApps: ToolDefinition;
    androidLaunchApp: ToolDefinition;
    androidBuildRun: ToolDefinition;
}
/** Create the app-lifecycle tools bound to one host controller. */
export declare function createAndroidAppTools(host: AndroidHostController): AndroidAppTools;
