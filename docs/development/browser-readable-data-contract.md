# Browser readable data contract

Source-only repair for the 1.0.60 browser read path. This does not patch an installed runtime, grant new browser access, or publish a release.

## Error attribution

`browser-playwright-attribute-forbidden` was a Host parameter allowlist rejection, not missing user authorization. The former list omitted ordinary `href`, `src`, `poster`, `srclang`, `kind`, `label`, and `lang`. Independently, the DOM gate rejected non-rendered `<track>`/`<source>` children even under a visible player.

The screenshot's `UnknownVizError` is an Electron/Chromium surface-copy error, not an unknown tool-card visualization type. [Electron 43.2.0 `electron_api_web_contents.cc`](https://raw.githubusercontent.com/electron/electron/v43.2.0/shell/browser/api/electron_api_web_contents.cc) maps `CopyFromSurfaceError::kUnknownVizError` to this literal and rejects the capture promise in `OnCapturePageDone`. The screenshot alone does not identify whether the failing tool action was screenshot or mediaFrame. Our self-owned hidden WebContentsView reproduces the adjacent native error `Current display surface not available for capture`, not the original site's exact GPU failure.

## Standard attribute reads

- Fixed selector grammar, sensitive locator/field gates, shared authorization, origin checks and action confirmations remain in force.
- Fixed allowlist admits standard presentation/accessibility/media fields (including the above URL/track fields, common media flags, dimensions and bounded ARIA descriptions).
- Direct `<track>` children of a rendered video/audio may expose only `src`, `srclang`, `kind`, `label`, `lang`; direct `<source>` children may expose only `src`, `type`. The exception applies only to getAttribute, not text/HTML or actions. No general hidden-node exception or picture/source exception is added.
- Read visibility ignores `pointer-events:none`; interactive action visibility retains that restriction. Ordinary hidden nodes still fail.
- URL attributes resolve relative URLs against the page base, then Host `safeUrl` removes userinfo, the entire query and fragment, and censors sensitive path text. Non-HTTP(S) values become empty. Missing attributes remain null. The returned address is a diagnostic clue, **not permission to navigate, download or fetch it**.
- `value`, arbitrary `data-*`, event handlers, `srcdoc`, HTML and script/style/state dumping remain forbidden. Script/style/template/noscript/meta/link contents are explicitly rejected even if CSS makes them visible.
- Unsupported-attribute guidance names the supported path and says repeated authorization is unnecessary. It remains an error, not successful empty data.

## mediaInfo (additive, read-only)

Existing `count`, `selectedIndex`, `videos`, `overlays`, player state and string `activeCues` are retained. Add:

- Per-player declarative `sources` with sanitized source URL and type.
- Per-text-track sanitized `source`, `readyState`, `cueCount`, `cuesUnavailable` and bounded `cuePreview` (`startTime`, `endTime`, `text`).
- Up to 12 visible videos, 20 sources/tracks, 5 preview cues per track, 20 active cue strings per player; shared cue-text budget 20,000 characters with at most 1,000 per cue. All cue/label/overlay output is censored by the Host.

No track is enabled, URL fetched, page navigated, video sought or overlay dismissed by mediaInfo. A disabled/unloaded track reports `cuesUnavailable:true`/`cueCount:null`; it does not pretend subtitles are absent. Blob/MSE resources are not exported as arbitrary data URLs.

## Native capture recovery

After existing screenshot/media sensitive-content preflight:

1. Capture the native surface once with `stayHidden:true`, `stayAwake:true`, bounded to 2 seconds.
2. Only an empty native image or known native capture error (`UnknownVizError`, `VizSentEmptyBitmap`, unavailable surface, frame gone, timeout) permits **one** fixed `Page.captureScreenshot` fallback. Unknown failures do not enter fallback.
3. Check visible sensitive fields and rendered text intersecting the intended crop before capture, after native success/failure, and after CDP success. Reuse the existing Host sensitive-value/redaction detectors; do not treat ordinary prose keywords as secrets. Scan up to 5,000 text nodes and 12,000 visible characters; incomplete inspection returns `browser-capture-inspection-limit` without an image. Unrendered/off-crop text is excluded from this additional inspection. CDP captures only the visible viewport (`fromSurface:true`, `captureBeyondViewport:false`), bounded to 2 seconds. For media, Host converts the CSS crop to actual PNG pixels, crops in memory, and emits only cropped bytes. It never emits the full viewport for a mediaFrame. No model-controlled CDP/script/clip parameters, emulation, focus, sidebar visibility or authorization changes occur.
4. After every asynchronous capture/read boundary, assert the operation's Profile/model generation and abort signal, shared control, exact tab/view availability, URL and navigation generation. Stale/Stop results are discarded before image conversion/attachment output.
5. A decoded, non-empty PNG is required. The result includes `captureEngine` and, on recovery, `nativeFailure`. Exhausted capture returns `browser-capture-unavailable` with actionable guidance to use mediaInfo/observe; it is never a successful image or a demand for new authorization.

Hidden scrolled compositor surfaces can still be unavailable, including a separate DPR1 probe. The fallback is bounded conditional recovery, not a promise that Chromium can render every hidden surface. Do not loop capture calls or silently unhide the browser to disguise that limitation. Per the later task split, offscreen lifecycle support belongs to a separate implementation and acceptance task; acceptance of this read-path repair does not accept all background screenshot behavior.

## Output consumer contract

The plugin still converts Host `image` data URLs to a durable attachment only for an image-capable model. `output.render` returns standard text blocks and `{type:'image', attachment: ImageAttachmentRef}`. Alpha5 `dsh-api-session-controller.imageBlockIn` resolves that reference; `dsh-client-ui-conversation` reads attachment bytes through the current session and constructs a Blob URL. No custom Viz type or renderer patch is introduced. Missing image capability retains existing explicit `imageUnavailable` behavior.

## Validation scope

Self-owned Electron fixtures cover ordinary and sensitive attribute reads, real PNG recovery, media cue metadata, masks, Stop/navigation/tab invalidation, high-DPI crop behavior and bounded compositor failures. A separate test passes the recovered PNG through the actual alpha5 saveImageFile/readImageFile and imageBlockIn consumer. Official suite changes belong to the independent testing task. The installed GUI and the original studio.blender.org video require root-level final validation after the maintained source is built into the actual GUI; source fixture success is not a claim of deployment.
