/**
 * Live device stream card (`android_boot`).
 *
 * The device display lives in the persistent right-side panel, so this card
 * renders NO imagery: the conversation stream shows a compact one-line summary
 * (tool title, device name, status badge, "open in sidebar" affordance) and
 * clicking the row opens the panel via the row-click trigger.
 *
 * While settled with a parseable `android-stream` meta, the card registers its
 * result as an openable source for the device panel and — because `android_boot`
 * is the explicit START verb — auto-opens the panel exactly once.
 */
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client';
import type { AndroidFetcher } from './protocol.js';
import { type AndroidMetaSource } from './android-meta-hydrate.js';
import { type AndroidLocale } from './copy.js';
import { type AndroidPanelSource } from './android-panel-trigger.js';
/** Injectable surfaces every card accepts (tests, headless hosts). */
export interface AndroidCardOptions {
    fetcher?: AndroidFetcher;
    colorScheme?: 'light' | 'dark';
    locale?: string;
    /** Auto-open callback: fire once when a settled START result should open
     * the panel. */
    autoOpen?: (source: AndroidPanelSource) => void;
}
/**
 * Shared compact card chrome: a one-line-ish head with the tool title, the
 * device name, a status badge and the non-interactive "open in sidebar"
 * affordance (the row click itself opens the panel, so the cue never swallows
 * the gesture), plus an optional slim body for state copy/meta.
 */
export declare function androidCardChrome({ title, actionLabel, actionId, deviceLabel, badge, dataState, toolName, locale, openable, children, metaSource, }: {
    title: string;
    /** Small secondary action sub-label right after the title. */
    actionLabel?: string;
    /** Stable action id for the `data-android-card-action` marker. */
    actionId?: string;
    deviceLabel?: string;
    badge?: React.ReactNode;
    dataState: 'running' | 'live' | 'fallback' | 'error';
    toolName: string;
    locale: AndroidLocale;
    openable: boolean;
    children?: React.ReactNode;
    /** Origin of the card's meta; rendered as a data attr for debuggability. */
    metaSource?: AndroidMetaSource;
}): React.JSX.Element;
/** Compact device label: the human name, falling back to the serial. */
export declare function androidCardDeviceLabelOf(device: {
    serial?: string;
    name?: string;
} | undefined): string;
/**
 * Conversation card for `android_boot`. Running → "starting" state; settled
 * with the `android-stream` meta → the compact live summary; anything else →
 * a defensive fallback that never throws.
 */
export declare function AndroidStreamCard(props: ToolCallViewProps & AndroidCardOptions): React.JSX.Element;
