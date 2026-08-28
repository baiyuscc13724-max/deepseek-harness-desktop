/**
 * Screenshot card (`android_screenshot` and `android_interact`).
 *
 * The device display lives in the persistent right-side panel, so the card
 * never grants/renders the PNG inline: it renders the shared compact one-line
 * summary (tool title, device name, 完成 badge, "open in sidebar" affordance)
 * plus the durable caption's byte size/dimensions and the 打开截图 link.
 * Clicking the row opens the panel via the row-click trigger; settled
 * meta-carrying results register as openable sources for the panel.
 */
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client';
import { type AndroidCardOptions } from './android-stream-card.js';
/**
 * Conversation card for `android_screenshot` / `android_interact`. Compact
 * summary row with the openFile (打开截图) link; never renders an `<img>` and
 * never throws.
 */
export declare function AndroidScreenshotCard(props: ToolCallViewProps & AndroidCardOptions): React.JSX.Element;
