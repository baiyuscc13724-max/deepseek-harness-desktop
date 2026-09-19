# Browser offscreen presentation — shell-only contract

Status: renderer contract for bf3; production main/preload implementation belongs to task 965. This is not a model capture API or permission grant.

## Fixed lanes / identity

The original tab WebContents remains the page, DOM, profile and input target. The shell canvas is a presentation of that WebContents, never an alternate page or a model browser target. No purpose/lane selector is accepted from models, web pages or user URLs.

Renderer consumes only fixed `desktopHarness` preload methods below. Main must enforce the exact trusted shell main-frame sender, tab ownership and its own current presentation binding. Model Stop does not revoke the user's manual page interaction, and manual interaction does not resume model control. No input text is logged, placed in data attributes, or echoed in status messages.

## Preload methods (all optional until production bridge is integrated)

- `onBrowserPresentationFrame(callback) -> unsubscribe`
- `setBrowserPresentationViewport({visible,width,height,clientRevision,tabId}) -> Promise<binding>`
- `ackBrowserPresentationFrame({tabId,viewGeneration,requestId,frameSequence,status}) -> Promise`
- `inputBrowserPresentation({tabId,viewGeneration,requestId,frameSequence,event}) -> Promise`

`binding = {available,clientRevision,tabId,viewGeneration,viewport:{width,height,scrollX,scrollY,devicePixelRatio}}`.

The shell's width/height are its display-area CSS dimensions, rounded to integer, bounded 1..8192. Main determines the original WC DIP size and actual CSS viewport; **returned viewport.width/height are authoritative**, including page zoom. Do not infer them by dividing frame pixels by OS DPR. Main increments viewGeneration on navigation, tab, resize, zoom or surface replacement and returns the exact requested clientRevision. A hidden request stops the pump and clears held keys/buttons/composition on the original WC. An obsolete clientRevision cannot reactivate presentation.

Browser state additionally exposes `presentation:{enabled:true,viewGeneration}` and `activeTabId`. Changing tab/generation immediately invalidates the renderer binding. Absent/disabled presentation retains existing native-browser UI; it must not falsely mark OSR as displayed. Binding results are accepted only for the current selected tab and outstanding local clientRevision. A frame may not establish or update the selected tab itself.

## Frame

```js
{
  tabId, captureLane: 'presentation', requestId, frameSequence, viewGeneration,
  viewport: {width,height,scrollX,scrollY,devicePixelRatio},
  rect: {x:0,y:0,width:viewport.width,height:viewport.height},
  framePixelWidth, framePixelHeight,
  dataURL // bounded data:image/png|jpeg|webp;base64, no URL fetch
}
```

The presentation lane sends complete visible-viewport frames, not model-sensitive crops. `rect` is viewport CSS coordinates, NOT document scroll coordinates. Actual image decode dimensions must exactly match framePixelWidth/Height. Model lane/crops, mismatched tab/generation/viewport, non-monotonic sequence, malformed images, excessive dimensions and late decoded frames are discarded. Renderer upper bounds: 8192 per image edge, 16,777,216 pixels, 24MiB data URL text; main should use a smaller practical encode budget.

Only one frame is in flight until an exact ACK. Renderer decodes at most one image and retains one canvas; it ACKs presented only after decoding and drawing, and ACKs discarded for rejected known tokens. No request means no unsolicited new capture. Main must have a bounded ACK timeout; renderer has a 2s decode timeout. Hide/resize/tab/navigation/destroy cancels decoding and clears canvas immediately. ACK delivery failure stops the renderer; no uncertain automatic replay. Duplicate tokens must be idempotent on Host.

## Manual input event union

Every input carries the exact displayed frame token, except Host lifecycle cancellation performed by setBrowserPresentationViewport. Main validates the token and generation again at dispatch. Renderer forwards only trusted DOM events from its own focused input surface, never window messages or page events.

- `{type:'pointer',action:'down'|'move'|'up'|'leave',x,y,button:'left'|'middle'|'right',buttons,clickCount,modifiers}`
- `{type:'wheel',x,y,deltaX,deltaY,modifiers}`
- `{type:'key',action:'down'|'up',key,code,location,repeat,modifiers}`
- `{type:'text',text}`
- `{type:'composition',action:'start'|'update'|'end'|'cancel',text}`
- `{type:'edit',command:'copy'|'cut'|'paste'|'selectAll'|'undo'|'redo'}`
- `{type:'focus',focused:boolean}`

`modifiers` is the fixed subset shift/control/alt/meta. Coordinates are **original viewport CSS**, computed using the contained image's actual display rectangle, not canvas backing pixels or guessed DPR. Host converts CSS to original WC DIP using its own zoom/viewport mapping. Pointer drag uses capture and clamps outside moves to the frame edge; initial clicks in letterbox padding are rejected. Wheel delta is DOM semantic (positive Y scrolls down), scaled from displayed CSS pixels to original viewport CSS; Host performs Electron sign/DIP conversion. Release/cancel must not leave held input on the original page.

Keyboard keydown/up and committed text are separate to avoid duplicate characters. Editing shortcuts are fixed original-WC edit operations, not reading clipboard through the model. Ctrl/Cmd+L focuses the existing shell address bar. Tab stays within original page keyboard traversal; Escape remains available to the shell's existing close handling. Composition updates are preedit, end commits exactly once; ordinary trailing composition input is suppressed. Host may use its existing CDP transport's fixed `Input.imeSetComposition` / `Input.insertText` for the ORIGINAL WebContents, not arbitrary script, and must cancel preedit on blur/invalidation. Host must coordinate its existing debugger session, never attach a competing model debugger.

Text/preedit is bounded to 32768 UTF-16 units per message. Input queue max64 with one call in flight; coalesced pointer-move/wheel samples are bounded to one rAF. Overflow/bridge failure invalidates the UI, clears the queue and requests a hidden lifecycle reset, rather than dropping a mouseUp/keyUp and continuing. The native transparent textarea is only the manual IME conduit; its transient value is cleared after commit/blur and is never copied to attributes or diagnostic logs.

## Integration / layout

`HarnessBrowserPresentation.create({host,api,onAddressFocus})` returns `{setState({enabled,tabId,viewGeneration,visible}),invalidate(),destroy()}`. `browser-sidebar.js` owns one instance, mounts it inside the existing browser pane before its footer, and combines workspace open/browser mode, utility-panel/overlay visibility and document visibility. Browser state changes do not steal focus. Component ResizeObserver coalesces reconfiguration; hidden/zero-area hosts never pump frames. Existing address/navigation/tabs/history/downloads/Profile/Stop remain their existing controls.

Main must disable the old native foreground view only when presentation is actually selected and ready to receive frames. The new shell canvas must not obscure utility panels, permission dialogs or menus. Original page context-menu events must render their menu against the visible shell window, not the hidden OSR owner. No fallback to model capture, blank success, duplicate login page or visible/activated hidden browser window is allowed.

## Validation ownership

The UI task runs an isolated real Electron component against an original offscreen WC using a local test bridge, checking pixels, trusted mouse/wheel/key/text/Chinese composition DOM receipts, stale decode/tab/resize, hide/ACK and cleanup. This proves component behavior, not production sender authorization. Task 965 wires actual main/preload; e139 independently persists tests and verifies complete production boundaries. OSR does not expose the original page's semantic accessibility tree via canvas; the component labels and keyboard focus are real, but full native screen-reader page semantics require a separate accessibility bridge and are not claimed here.
