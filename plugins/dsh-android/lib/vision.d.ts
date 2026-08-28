/**
 * Native multimodal delivery: hand the model the screenshot itself.
 *
 * DSH 0.1.1 carries images end to end — tool results may contain
 * `{type:'image', attachment}` blocks (the adapter walks tool-result content
 * recursively), bytes live in the durable attachment store (`ctx.get(
 * 'attachments')`), and `llm.resolveModelInfo(...).inputModalities` says
 * whether the routed model declares image input. `read_image` in dsh-tool-fs
 * is the canonical in-tree pattern this module mirrors.
 *
 * The dsh-android stance differs from `read_image` in one deliberate way:
 * where `read_image` REFUSES on a text-only route (the image is its entire
 * point), the capture tools here DEGRADE — their primary output is the JSON
 * summary, and the image block is an enhancement added only when (a) the
 * attachment store is mounted, (b) the calling route's resolved model
 * declares `image` input, and (c) admission succeeds. Any failure in that
 * chain silently keeps the rc.1 behavior, so text-only routes, headless
 * profiles, and older hosts never see a new error.
 *
 * Everything here is typed structurally: the plugin's compiled-against
 * typings (`^0.1.0-rc.6`) predate the attachment/vision APIs, so depending
 * on their type exports would break the independent-checkout build.
 * @module @zseven-w/dsh-android/vision
 */
/** The durable attachment reference an image block carries (plain JSON). */
export interface AndroidImageRef {
    attachmentId: string;
    mediaType: string;
    bytes: number;
    width: number;
    height: number;
    name?: string;
}
/** Structural face of the `attachments` service (AttachmentStore). */
export interface AttachmentStoreLike {
    saveImage(input: {
        data: Uint8Array;
        mediaType: string;
        name?: string;
    }): Promise<AndroidImageRef>;
}
/** Structural face of the `llm` service's model-info resolution. */
export interface LlmServiceLike {
    resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<{
        inputModalities?: readonly string[];
    }>;
}
/** Structural face of the exec context fields the route gate reads. */
export interface VisionExecLike {
    signal?: AbortSignal;
    agent?: {
        session?: {
            requestHeader?: () => {
                config?: {
                    provider?: string;
                    model?: string;
                };
            } | undefined;
        };
        options?: {
            provider?: string;
            model?: string;
        };
    };
}
/** The services the capture tools need to emit image blocks. */
export interface AndroidVisionServices {
    attachments?: AttachmentStoreLike;
    llm?: LlmServiceLike;
}
/**
 * Resolve the optional vision services from the plugin context. Both come
 * back undefined on hosts that do not mount them; every consumer treats
 * that as "stay text-only".
 */
export declare function resolveVisionServices(ctx: unknown): AndroidVisionServices;
/**
 * True when the calling route's resolved model declares `image` input.
 * Mirrors `read_image`'s gate (request-header config first, then the agent
 * options) but answers false instead of throwing: a tool result that enters
 * durable history must not carry an image its route cannot replay, and for
 * our capture tools the safe degradation is "no image block".
 */
export declare function imageInputActive(services: AndroidVisionServices, exec: VisionExecLike): Promise<boolean>;
/**
 * Durably commit one screenshot PNG and return the plain reference for the
 * result value, or undefined when the store is absent or admission fails
 * (oversized, malformed) — never an error, per the degrade-not-refuse rule.
 */
export declare function saveScreenshotAttachment(services: AndroidVisionServices, png: Uint8Array, name: string): Promise<AndroidImageRef | undefined>;
/** Output-schema fragment for the optional `image` result field. */
export declare const IMAGE_REF_SCHEMA: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly description: string;
    readonly properties: {
        readonly attachmentId: {
            readonly type: "string";
            readonly required: true;
        };
        readonly mediaType: {
            readonly type: "string";
            readonly required: true;
        };
        readonly bytes: {
            readonly type: "number";
            readonly required: true;
        };
        readonly width: {
            readonly type: "number";
            readonly required: true;
        };
        readonly height: {
            readonly type: "number";
            readonly required: true;
        };
        readonly name: {
            readonly type: "string";
        };
    };
};
/**
 * Render one JSON summary plus, when the value carries an `image` ref, the
 * image block itself — so an image-capable model SEES the screen instead of
 * reading a path. The cast is deliberate: the compiled-against rc.6 typings
 * predate the `image` content-block entry, while the 0.1.1 runtime walks it.
 */
export declare function renderJsonWithImage(_args: unknown, value: unknown): Array<{
    type: 'text';
    text: string;
}>;
