/**
 * Defensive readers for the settled ToolResultNode behind a card. The
 * presentationMeta is the primary contract, but the durable result text still
 * carries the model-facing summary (bytes, dimensions, action) the screenshot
 * card shows as its caption.
 */
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client';
export interface AndroidResultSummary {
    bytes?: number;
    width?: number;
    height?: number;
    action?: string;
    path?: string;
}
/** Parse the first JSON text content block of a settled result, if any. */
export declare function androidResultSummaryOf(block: ToolCallBlock): AndroidResultSummary | undefined;
/** Join the durable result text for the fallback disclosure. */
export declare function androidResultTextOf(block: ToolCallBlock): string | null;
