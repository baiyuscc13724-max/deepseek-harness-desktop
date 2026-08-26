import z from "@deepseek-ai/schemastery";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { join } from "node:path";
import { ALLOWED_SIZES, executeImageBridge, validateConfig } from "./core.js";

export const name = "codex-image-bridge";
export const inject = ["tools", "attachments", "fs", "systemPrompt"];
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export const Config = z.object({
  enabled: z.boolean().default(false),
  codexExecutable: z.string().default(""),
  codexHome: z.string().default(""),
  timeoutMs: z.number().default(180_000),
  graceMs: z.number().default(2_000),
  maxPromptChars: z.number().default(8_000),
  maxInputBytes: z.number().default(MAX_IMAGE_BYTES),
  maxOutputBytes: z.number().default(MAX_IMAGE_BYTES),
  stdoutMaxBytes: z.number().default(256 * 1024),
  stderrMaxBytes: z.number().default(64 * 1024),
});

function imageRef(value) {
  return {
    attachmentId: value.attachmentId, mediaType: value.mediaType, bytes: value.bytes,
    width: value.width, height: value.height,
    ...(value.name === undefined ? {} : { name: value.name }),
    ...(value.originalDimensions === undefined ? {} : { originalDimensions: { ...value.originalDimensions } }),
  };
}

const IMAGE_SCHEMA = {
  type: "object", required: true, additionalProperties: false,
  properties: {
    attachmentId: { type: "string", required: true },
    mediaType: { type: "string", enum: ["image/png", "image/jpeg", "image/webp", "image/gif"], required: true },
    bytes: { type: "integer", required: true }, width: { type: "integer", required: true }, height: { type: "integer", required: true },
    name: { type: "string" },
    originalDimensions: { type: "object", additionalProperties: false, properties: {
      width: { type: "integer", required: true }, height: { type: "integer", required: true },
    } },
  },
};

function register(ctx, config) {
  ctx.systemPrompt.section({
    name: "tool:image_gen", order: 106,
    text: "Use image_gen whenever the user asks to generate or edit an image. For edit mode, provide a source image path inside the current workspace. The tool returns the resulting image as a durable attachment.",
  });
  ctx.tools.register(defineTool({
    name: "image_gen",
    description: "Generate or edit one image through the explicitly configured local Codex CLI. Caller-controlled executable, argv, environment, output path, and permission overrides are forbidden. The result is revalidated by the Harness attachment store.",
    timeoutMs: config.timeoutMs + config.graceMs + 5_000,
    parameters: {
      mode: { type: "string", enum: ["generate", "edit"], required: true, description: "generate creates; edit transforms input_image_path." },
      prompt: { type: "string", required: true, description: `Visual instructions, at most ${config.maxPromptChars} characters.` },
      size: { type: "string", enum: [...ALLOWED_SIZES], required: true, description: "Requested square, landscape, or portrait aspect preset; Codex may choose a nearby pixel resolution." },
      input_image_path: { type: "string", description: "Required only for edit; must be inside the session workspace." },
    },
    output: {
      schema: { type: "object", additionalProperties: false, properties: {
        mode: { type: "string", enum: ["generate", "edit"], required: true },
        size: { type: "string", enum: [...ALLOWED_SIZES], required: true }, image: IMAGE_SCHEMA,
      } },
      render: (_args, value) => [
        { type: "text", text: `Created ${value.mode === "edit" ? "edited" : "generated"} ${value.size} image.` },
        { type: "image", attachment: imageRef(value.image) },
      ],
    },
    isConcurrencySafe: () => false,
    execute(args, exec) {
      return executeImageBridge(args, exec, { fs: ctx.fs, subprocess: ctx.subprocess, attachments: ctx.attachments }, config);
    },
    presentCall(args) {
      return { card: "generic", title: args.mode === "edit" ? "Edit image with Codex" : "Generate image with Codex", kind: "execute", rawInput: args.prompt,
        ...(args.input_image_path === undefined ? {} : { locations: [{ path: args.input_image_path }] }) };
    },
  }));
}

export function apply(ctx, config) {
  const resolved = {
    enabled: config.enabled,
    codexExecutable: config.codexExecutable,
    codexHome: config.codexHome,
    outputRoot: join(resolveDshHome(), "plugins", name, "output"),
    timeoutMs: config.timeoutMs, graceMs: config.graceMs, maxPromptChars: config.maxPromptChars,
    maxInputBytes: Math.min(config.maxInputBytes, ctx.attachments.imageLimits.maxImageBytes),
    maxOutputBytes: Math.min(config.maxOutputBytes, ctx.attachments.imageLimits.maxImageBytes, ctx.attachments.imageLimits.maxMessageImageBytes),
    stdoutMaxBytes: config.stdoutMaxBytes, stderrMaxBytes: config.stderrMaxBytes,
  };
  validateConfig(resolved);
  if (!resolved.enabled) return;
  ctx.inject(["subprocess"], (child) => register(child, resolved));
}