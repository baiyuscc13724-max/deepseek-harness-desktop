# DSH Codex Image Bridge

A from-scratch DeepSeek Harness server plugin exposing one fixed-schema `image_gen` tool backed by the locally authenticated Codex CLI. It contains no marketplace plugin code.

This is the maintained in-repo location of the plugin, shipped as part of Harness Desktop (`plugins/dsh-codex-image-bridge`, version aligned to the package release).

## Requirements

- DSH packages compatible with `0.1.1-rc.2`
- Node.js 20+
- Codex CLI with `image_generation` enabled and an existing local login
- DSH `tools`, `attachments`, `fs`, `systemPrompt`, and `subprocess` services

## Tool

```json
{
  "mode": "generate | edit",
  "prompt": "visual instructions",
  "size": "1024x1024 | 1536x1024 | 1024x1536",
  "input_image_path": "required only for edit; inside the session workspace"
}
```

The result is saved through `ctx.attachments.saveImage` and rendered as a native DSH image attachment.

## Security boundary

- Disabled by default; enabling requires an explicit absolute native Codex executable path.
- The tool schema is closed. Callers cannot supply argv, executable, environment, cwd, output paths, permissions, or model settings.
- User prompt text is sent through Codex stdin with a fixed final `-` argv marker; it is never interpreted as a CLI option or shell syntax.
- Codex is launched only through DSH `ctx.subprocess`, which scrubs credential-shaped and `DSH_*` environment variables and owns tree-scoped termination.
- Each call gets a random private request directory under `$DSH_HOME/plugins/codex-image-bridge/output`; it is removed only after the managed process finishes.
- User input and Codex output are resolved, contained, inspected, and byte-capped through `ctx.fs`.
- Edit inputs first pass full DSH attachment decoding/normalization. Only the verified normalized bytes are staged for Codex.
- Codex shell, unified-exec, browser, computer-use, in-app-browser, and apps features are disabled. `image_generation` and its required `code_mode_host` bridge are enabled; the Codex sandbox remains `workspace-write` with approvals disabled.
- The bridge parses only one UUID-shaped `thread.started` id from bounded JSONL stdout, then reads only `$CODEX_HOME/generated_images/<thread-id>`.
- Exactly one regular output image is accepted. Extension/magic, byte limits, full attachment decoding, and the requested aspect ratio (2% tolerance) are verified; Codex chooses the actual pixel resolution.
- Codex stdout/stderr is bounded but never included in model-facing errors.
- The tool is marked non-concurrency-safe, so calls are serialized by the tool runtime.

Node filesystem writes are limited to creating/removing the plugin-owned private request tree and staging attachment-normalized bytes. User-controlled reads and Codex output admission use DSH filesystem and attachment seams.

## Configuration

```yaml
config:
  enabled: true
  codexExecutable: 'C:\absolute\path\to\codex.exe'
  codexHome: 'C:\Users\you\.codex'
  timeoutMs: 180000
  graceMs: 2000
  maxPromptChars: 8000
  maxInputBytes: 20971520
  maxOutputBytes: 20971520
  stdoutMaxBytes: 262144
  stderrMaxBytes: 65536
```

There is no PATH search, PowerShell wrapper fallback, shell fallback, API-key fallback, or automatic login.

## Tests

Behavior tests live in the repository root suite as `tests/codex-image-bridge.test.cjs` (`node --test tests/codex-image-bridge.test.cjs`), covering the closed schema, config validation, media detection, managed subprocess lifecycle, attachment normalization, request isolation, cleanup, and single-output / dimension checks.