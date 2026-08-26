---
name: imagegen
description: "Generate or edit raster images with the native Harness image_gen tool. Use for photos, illustrations, textures, sprites, product/UI mockups, infographics, or targeted edits; do not use for code-native SVG/HTML/CSS visuals."
---

# Image Generation

> Modified by Harness Desktop Contributors from the Apache-2.0 OpenAI `imagegen` skill. This version removes Codex-only CLI/API-key paths and uses the bounded Harness `image_gen` tool and attachment store.

Use the native `image_gen` tool for all normal image generation and editing. It does not accept or require an API key from the user.

## Modes

### Generate

Call `image_gen` with:

- `mode: "generate"`
- a specific `prompt`
- one supported `size`: `1024x1024`, `1536x1024`, or `1024x1536`
- no `input_image_path`

### Edit

Call `image_gen` with:

- `mode: "edit"`
- a targeted edit prompt that repeats what must stay unchanged
- one supported `size`
- `input_image_path` pointing to an image inside the current workspace

Never use a page URL, attachment ID, arbitrary executable, output path, model name, credential, or extra argument as `input_image_path`. If the source is not yet a workspace file, ask the user to place or upload it there.

## Prompt workflow

1. Preserve every explicit user requirement. Do not invent brands, characters, copy, or story elements.
2. Normalize the request in this order: intended use; scene/background; subject; composition; lighting/style; literal text; invariants; exclusions.
3. For exact in-image copy, quote the literal text and require verbatim rendering with no extra characters.
4. For edits, say `change only ...; keep ... unchanged` and repeat identity/layout invariants on every iteration.
5. Choose the closest aspect preset from the intended use. Do not promise exact pixel dimensions beyond the tool's preset contract.
6. Call `image_gen`. Inspect the returned image and report the durable attachment.
7. Iterate with one deliberate change at a time. Do not silently make repeated generations that consume quota.

Read `references/prompting.md` for detailed prompt principles and `references/sample-prompts.md` only when a concrete recipe helps.

## Verification

- Confirm the result matches the requested subject, composition, text, and invariants.
- For edits, compare against the source and call out any unintended drift.
- For data graphics, verify every number and label against source data; AI imagery must not be the authority for numerical charts.
- If the image will be used by a project, tell the user the result is a Harness attachment and whether they still need to save it into a workspace asset path.

## Boundaries

- Do not request or handle an OpenAI API key, password, account, or verification code.
- Do not fall back to a shell, arbitrary script, SDK runner, or a caller-chosen executable if `image_gen` is unavailable. Report the unavailable tool instead.
- Do not overwrite an existing workspace asset unless the user explicitly requests replacement.
- Prefer repository-native SVG or HTML/CSS for established vector/icon systems and simple code-native graphics.
