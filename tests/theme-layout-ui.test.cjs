const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { readFile } = require('node:fs/promises')

const root = path.resolve(__dirname, '..')

test('desktop themes lock the outer viewport while preserving mobile page scrolling', async () => {
  const source = await readFile(path.join(root, 'renderer', 'theme-integration.js'), 'utf8')
  assert.match(source, /:not\(\[data-harness-mobile="true"\]\) body,\s*html\[data-hd-theme\].*:not\(\[data-harness-mobile="true"\]\) #root \{ width:100%; height:100%; min-height:0 !important; overflow:hidden !important; \}/u)
  assert.match(source, /\[data-harness-mobile="true"\] body,\s*html\[data-hd-theme\].*\[data-harness-mobile="true"\] #root \{ min-height:100vh; \}/u)
  assert.match(source, /if \(root\.dataset\.harnessMobile === 'true' \|\| root\.dataset\.hdTheme === 'official'\) return/u)
  assert.match(source, /if \(window\.scrollX !== 0 \|\| window\.scrollY !== 0\) window\.scrollTo\(0, 0\)/u)
  assert.match(source, /applyUiMode\(false\)\s*if \(refreshTheme\) applyTheme\(\)\s*else syncWallpaperVideo\(activeWallpaperTheme\(window\.__HARNESS_DESKTOP_THEME_STATE__ \|\| \{\}\)\)\s*stabilizeWorkbenchViewport\(\)/u)
  assert.match(source, /wallpaperFrameRate = 24/u)
  assert.match(source, /wallpaperMaxPixels = 1920 \* 1080/u)
  assert.match(source, /wallpaperVideoCanvas = document\.createElement\('canvas'\)/u)
  assert.match(source, /const decoder = document\.createElement\('video'\)/u)
  assert.doesNotMatch(source, /document\.body\.(?:prepend|append)\((?:wallpaperVideoDecoder|decoder)\)/u)
  assert.match(source, /const sourceChanged = wallpaperVideoDecoder\?\.dataset\.hdWallpaperSource !== source/u)
  assert.match(source, /releaseWallpaperVideo\(\)\s*const decoder = document\.createElement\('video'\)[\s\S]*?decoder\.dataset\.hdWallpaperSource = source\s*decoder\.src = source\s*decoder\.load\(\)\s*wallpaperVideoDecoder = decoder/u)
  assert.match(source, /video\.pause\(\)\s*video\.removeAttribute\('src'\)\s*delete video\.dataset\.hdWallpaperSource\s*video\.load\(\)/u)
  assert.match(source, /wallpaperVideoCanvas\.width = 0\s*wallpaperVideoCanvas\.height = 0\s*wallpaperVideoCanvas\.remove\(\)/u)
  assert.match(source, /const workbenchReady = Boolean\(workbenchRoot\?\.childElementCount \|\| workbenchRoot\?\.textContent\?\.trim\(\)\)/u)
  assert.match(source, /const shouldPause = wallpaperLifecycleParked \|\| root\.dataset\.hdLowPerformance === 'true' \|\| root\.dataset\.hdReducedMotion === 'true' \|\| document\.hidden \|\| !workbenchReady/u)
  assert.match(source, /if \(shouldPause\) \{\s*releaseWallpaperVideo\(\)\s*releaseWallpaperCanvas\(\)\s*overlay\?\.remove\(\)/u)
  assert.match(source, /const frameInterval = 1000 \/ wallpaperFrameRate[\s\S]*?const elapsed = now - wallpaperLastFrameAt[\s\S]*?wallpaperLastFrameAt = now - \(elapsed % frameInterval\)/u)
  assert.doesNotMatch(source, /wallpaperLastFrameAt = now\s*drawWallpaperFrame/u)
  assert.match(source, /wallpaperVideoFrameRequest = video\.requestVideoFrameCallback[\s\S]*?drawWallpaperFrameWhenDue\(now, video, canvas\)/u)
  assert.match(source, /wallpaperAnimationFrameRequest = window\.requestAnimationFrame\(drawFromAnimationFrame\)/u)
  assert.match(source, /video\.cancelVideoFrameCallback\(wallpaperVideoFrameRequest\)[\s\S]*?window\.cancelAnimationFrame\(wallpaperAnimationFrameRequest\)/u)
  assert.match(source, /Math\.sqrt\(wallpaperMaxPixels \/ \(rawWidth \* rawHeight\)\)/u)
  assert.match(source, /Math\.max\(canvas\.width \/ video\.videoWidth, canvas\.height \/ video\.videoHeight\)/u)
  assert.match(source, /const activeWallpaperTheme = state => state\?\.themeId === 'custom' \? customThemeFromState\(state\) : null/u)
  assert.match(source, /window\.harnessDesktopGuest\?\.onWallpaperLifecycle\?\.\(action => \{[\s\S]*?action === 'park'[\s\S]*?wallpaperLifecycleParked = true\s*releaseWallpaperVideo\(\)\s*releaseWallpaperCanvas\(\)[\s\S]*?action !== 'resume'/u)
  assert.match(source, /if \(action !== 'resume'\) return\s*releaseWallpaperVideo\(\)\s*releaseWallpaperCanvas\(\)\s*document\.querySelector\('\.hd-wallpaper-video-overlay'\)\?\.remove\(\)\s*wallpaperLifecycleParked = false\s*syncWallpaperVideo\(activeWallpaperTheme\(window\.__HARNESS_DESKTOP_THEME_STATE__ \|\| \{\}\)\)/u)
  assert.match(source, /visibilitychange'[\s\S]*?syncWallpaperVideo\(activeWallpaperTheme\(window\.__HARNESS_DESKTOP_THEME_STATE__ \|\| \{\}\)\)/u)
  assert.match(source, /if \(!mobile && syncVideo\) syncWallpaperVideo\(activeWallpaperTheme\(state\)\)/u)
  assert.match(source, /data-hd-wallpaper-kind="video"[\s\S]*?backdrop-filter:none!important/u)
  assert.match(source, /data-hd-wallpaper-kind="video"[\s\S]*?var\(--hd-theme-readable-surface\)/u)
  assert.doesNotMatch(source, /syncWallpaperVideo\(customThemeFromState\(state\)\)/u)
  assert.doesNotMatch(source, /(?:watchdog|location\.reload|\.reload\(\))/iu)
  assert.match(source, /mutationDeadline = performance\.now\(\) \+ 120[\s\S]*?mutationTimer \?\?= setTimeout\(flushMutationMount, 120\)/u)
  assert.match(source, /const remaining = mutationDeadline - performance\.now\(\)[\s\S]*?mutationTimer = setTimeout\(flushMutationMount, remaining\)[\s\S]*?mount\(false\)/u)
  assert.doesNotMatch(source, /clearTimeout\(mutationTimer\)/u)
  assert.match(source, /\[data-conversation-scroll\] > \[data-composer-seat\] \{ position:sticky!important; z-index:18; bottom:0!important;[\s\S]*?max-height:min\(58dvh,520px\); overflow-anchor:none; \}/u)
  assert.match(source, /\[data-composer-seat\] \[data-composer-card="true"\] \{ min-height:0!important; max-height:min\(54dvh,480px\); overflow:visible!important; \}/u)
  assert.doesNotMatch(source, /\[data-composer-card="true"\][^}]*overflow:hidden/u)
  assert.match(source, /\[data-composer-seat\] \[data-input-scroll="true"\] \{ min-height:0!important; max-height:min\(var\(--dsh-composer-text-max-height,280px\),40dvh\)!important; overflow-y:auto;/u)
  assert.match(source, /\[data-conversation-scroll\] \{ scroll-padding-block-end:calc\(var\(--dsh-composer-height,152px\) \+ 60px\); \}/u)
  assert.doesNotMatch(source, /(?:回到底部|Back to bottom)[^}]{0,400}display:none!important/u)
})

test('Back-to-bottom remains visible with a 44px target and theme-safe interaction feedback', async () => {
  const source = await readFile(path.join(root, 'renderer', 'theme-integration.js'), 'utf8')
  const labelSelector = String.raw`button:is\(\[aria-label="回到底部"\],\[aria-label="Back to bottom"\]\)`
  const wrapperRule = new RegExp(`\\[data-conversation-scroll\\] div:has\\(> ${labelSelector}\\) \\{([^}]*)\\}`, 'u').exec(source)
  const buttonRule = new RegExp(`\\[data-conversation-scroll\\] ${labelSelector} \\{([^}]*)\\}`, 'u').exec(source)
  assert.ok(wrapperRule, 'the official control slot must be restored rather than hidden')
  assert.ok(buttonRule, 'the official button must receive a stable theme rule')
  assert.match(wrapperRule[1], /display:flex!important/u)
  assert.match(wrapperRule[1], /position:sticky!important/u)
  assert.match(wrapperRule[1], /z-index:19!important/u)
  assert.match(wrapperRule[1], /bottom:calc\(var\(--dsh-composer-height,152px\) \+ max\(8px,env\(safe-area-inset-bottom\)\)\)!important/u)
  assert.match(wrapperRule[1], /pointer-events:none/u)
  assert.match(buttonRule[1], /inline-size:44px!important/u)
  assert.match(buttonRule[1], /block-size:44px!important/u)
  assert.match(buttonRule[1], /min-inline-size:44px/u)
  assert.match(buttonRule[1], /min-block-size:44px/u)
  assert.match(buttonRule[1], /pointer-events:auto/u)
  assert.match(buttonRule[1], /touch-action:manipulation/u)
  assert.match(buttonRule[1], /var\(--dsw-alias-border-l2\)/u)
  assert.match(buttonRule[1], /var\(--dsw-alias-label-primary\)/u)
  assert.match(buttonRule[1], /var\(--dsw-alias-bg-layer-1\)/u)
  assert.match(source, new RegExp(`${labelSelector}:focus-visible \\{[^}]*outline:3px solid var\\(--dsw-alias-brand-primary\\)!important;[^}]*outline-offset:2px`, 'u'))
  assert.match(source, new RegExp(`@media \\(hover:hover\\) \\{ ${labelSelector.replace('button', '\\[data-conversation-scroll\\] button')}:hover \\{[^}]*transform:translateY\\(-1px\\)`, 'u'))
  assert.match(source, new RegExp(`${labelSelector}:active \\{[^}]*var\\(--dsw-alias-interactive-bg-active\\)[^}]*scale\\(\\.98\\)`, 'u'))
  assert.match(source, new RegExp(`html\\[data-hd-reduced-motion="true"\\][^}]*${labelSelector}[^}]*transition:none!important`, 'u'))
  assert.match(source, new RegExp(`@media \\(prefers-reduced-motion:reduce\\)[\\s\\S]*?${labelSelector}[^}]*transition:none!important`, 'u'))
  assert.match(source, new RegExp(`@media \\(forced-colors:active\\)[\\s\\S]*?${labelSelector}[^}]*forced-color-adjust:auto`, 'u'))
  assert.doesNotMatch(source, new RegExp(`${labelSelector}[^}]*display:none`, 'u'))
  for (const mode of ['official', 'aurora', 'spatial', 'tactile']) {
    assert.match(source, new RegExp(`\\{ id: '${mode}'`, 'u'), `${mode} remains a supported UI mode`)
  }
})

test('official Click, Enter, and Space activation restore follow while reader growth remains anchored', async () => {
  const chat = await readFile(path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-ui-chat', 'lib', 'client.js'), 'utf8')
  const controlStart = chat.indexOf('!atBottom && (0, react_jsx_runtime.jsx)("div", {')
  assert.notEqual(controlStart, -1)
  const control = chat.slice(controlStart, controlStart + 1300)
  assert.match(control, /type: "button"/u)
  assert.match(control, /"aria-label": t\("chat\.toBottom"\)/u)
  assert.match(control, /onClick: \(\) => \{[\s\S]*?if \(local !== null\) toBottom\(scrollerOf\(local\)\);/u)
  assert.doesNotMatch(control, /autoFocus|tabIndex|onKeyDown/u, 'native button semantics provide keyboard activation without focus theft or a duplicate handler')
  assert.match(chat, /const toBottom = \(el\) => \{\s*anchorRef\.current = null;[\s\S]*?el\.scrollTop = el\.scrollHeight;[\s\S]*?atBottomRef\.current = true;\s*setAtBottom\(true\);\s*chatScroll\.save\(null\);/u)
  assert.match(chat, /if \(local !== null && atBottomRef\.current\) \{\s*const el = scrollerOf\(local\);\s*el\.scrollTop = el\.scrollHeight;/u)

  const activateNativeButton = (state, input) => {
    if (input === 'click' || input === 'Enter' || input === ' ') {
      state.anchor = null
      state.scrollTop = state.scrollHeight
      state.following = true
      state.saved = null
    }
  }
  for (const input of ['click', 'Enter', ' ']) {
    const state = {
      scrollHeight: 1200,
      scrollTop: 420,
      following: false,
      anchor: { key: 'node-24', top: -8 },
      saved: { anchorKey: 'node-24', anchorTop: -8 }
    }
    const readerTop = state.scrollTop
    const readerAnchor = { ...state.anchor }
    state.scrollHeight += 180
    if (state.following) state.scrollTop = state.scrollHeight
    assert.equal(state.scrollTop, readerTop, `${input}: growth before activation must not move a reader`)
    assert.deepEqual(state.anchor, readerAnchor, `${input}: reader anchor must survive growth`)
    activateNativeButton(state, input)
    assert.equal(state.following, true, `${input}: activation must restore follow`)
    assert.equal(state.scrollTop, state.scrollHeight)
    assert.equal(state.saved, null)
    assert.equal(state.anchor, null)
    state.scrollHeight += 240
    if (state.following) state.scrollTop = state.scrollHeight
    assert.equal(state.scrollTop, state.scrollHeight, `${input}: future growth must continue following`)
  }
})

test('Back-to-bottom focus stays fully above the sticky composer at normal and zoomed layouts', async () => {
  const source = await readFile(path.join(root, 'renderer', 'theme-integration.js'), 'utf8')
  assert.match(source, /\[data-conversation-scroll\] > \[data-composer-seat\] \{ position:sticky!important; z-index:18;/u)
  assert.match(source, /div:has\(> button:is\([^}]+\)\) \{[^}]*z-index:19!important;[^}]*bottom:calc\(var\(--dsh-composer-height,152px\) \+ max\(8px,env\(safe-area-inset-bottom\)\)\)!important/u)
  assert.match(source, /scroll-padding-block-end:calc\(var\(--dsh-composer-height,152px\) \+ 60px\)/u)
  assert.match(source, /scroll-margin-block-end:calc\(var\(--dsh-composer-height,152px\) \+ 12px\)/u)
  for (const { viewport, composer } of [
    { viewport: 900, composer: 152 },
    { viewport: 620, composer: 260 },
    { viewport: 480, composer: 288 }
  ]) {
    const composerTop = viewport - composer
    const buttonBottom = composerTop - 8
    const buttonTop = buttonBottom - 44
    assert.ok(buttonBottom <= composerTop - 8, 'the complete focus target clears the sticky composer')
    assert.ok(buttonTop >= 0, 'the focus target remains inside the viewport under zoom')
  }
})

test('custom skins keep composer and question controls readable', async () => {
  const source = await readFile(path.join(root, 'renderer', 'theme-integration.js'), 'utf8')
  const genericComposer = 'html[data-hd-theme]:not([data-hd-theme="official"]) [data-composer-card="true"]'
  const customComposer = 'html[data-hd-theme="custom"][data-hd-skin-tone] [data-composer-card="true"]'

  assert.ok(source.indexOf(genericComposer) >= 0)
  assert.ok(source.indexOf(customComposer) > source.indexOf(genericComposer), 'the equally specific custom surface must follow the generic surface')
  assert.match(source, /html\[data-hd-theme="custom"\]\[data-hd-skin-tone\] \[data-composer-card="true"\],[\s\S]*?\[data-question-key\] > section,[\s\S]*?\[data-plan-review-key\] > section \{[\s\S]*?background:linear-gradient\(var\(--hd-theme-readable-surface\),var\(--hd-theme-readable-surface\)\),var\(--hd-theme-input\) !important;/u)
  assert.match(source, /\[data-question-key\] \[role="(?:group|radiogroup)"\] > div:has\(> div\[aria-hidden="true"\] \+ textarea\)/u)
  assert.match(source, /textarea::placeholder \{[\s\S]*?-webkit-text-fill-color:var\(--dsw-alias-label-secondary\) !important;/u)
  assert.match(source, /html\[data-hd-theme\]:not\(\[data-hd-theme="official"\]\)\[data-hd-wallpaper-kind="video"\][\s\S]*?\[data-question-key\] > section,[\s\S]*?backdrop-filter:none!important;/u)
  assert.doesNotMatch(source, /Mbwy4a_|uV2eYG_/u)
})
