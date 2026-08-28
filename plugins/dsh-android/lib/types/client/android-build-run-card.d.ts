/**
 * Build & run card (`android_build_run`).
 *
 * The device display lives in the persistent right-side panel, so the card
 * renders the shared compact summary (tool title, device name, 完成 badge,
 * "open in sidebar" affordance) with a slim meta line carrying the launched
 * package name and the open-APK link; the panel's stream mode renders the
 * live view for the device. Running calls show a building state; errors and
 * meta-less results fall back to the defensive plain card. Settled results
 * register as openable panel sources.
 */
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client';
import { type AndroidCardOptions } from './android-stream-card.js';
export declare function AndroidBuildRunCard(props: ToolCallViewProps & AndroidCardOptions): React.JSX.Element;
