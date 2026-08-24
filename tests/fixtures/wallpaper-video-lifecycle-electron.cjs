const assert = require('node:assert/strict')
const { existsSync, mkdirSync, rmSync, statSync, writeFileSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BrowserWindow, ipcMain } = require('electron')

const repoRoot = path.resolve(__dirname, '..', '..')
const guestPreload = path.join(repoRoot, 'electron', 'guest-preload.cjs')
const defaultVideo = path.join(repoRoot, '.artifacts', 'wallpaper-ui-qa-20260823', 'themes', 'wallpaper-661c1687-8193-40e8-88d3-a9ee8d0f0bc8.mp4')
const videoFlag = process.argv.indexOf('--video')
const videoPath = path.resolve(videoFlag >= 0 && process.argv[videoFlag + 1] ? process.argv[videoFlag + 1] : process.env.HARNESS_WALLPAPER_STRESS_VIDEO || defaultVideo)
const cyclesFlag = process.argv.indexOf('--cycles')
const cycleCount = Number.parseInt(cyclesFlag >= 0 ? process.argv[cyclesFlag + 1] : '10', 10)
const lifecycleChannel = 'appearance:wallpaper-lifecycle'
const tempRoot = path.join(os.tmpdir(), `harness-wallpaper-lifecycle-${process.pid}`)

assert.ok(existsSync(videoPath), `video fixture does not exist: ${videoPath}`)
assert.ok(Number.isSafeInteger(cycleCount) && cycleCount >= 10 && cycleCount <= 30, 'cycle count must be between 10 and 30')

app.setName('Harness Wallpaper Lifecycle QA')
app.setPath('userData', path.join(tempRoot, 'user-data'))
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

function pageHtml() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Harness wallpaper lifecycle QA</title>
  <style>
    html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}
    body{background:#172033;color:#fff;font:16px sans-serif}
    #root{position:relative;z-index:1}
    #probe{position:absolute;left:96px;top:92px;width:220px;height:72px;z-index:2}
    #theme-probes{position:absolute;left:-10000px;top:0;width:720px}
    #composer-probe,#question-card-probe,#question-answer-probe{color:#fff;background:#fff;border:1px solid #fff}
    #composer-probe textarea{color:transparent;-webkit-text-fill-color:transparent;background:transparent}
  </style>
</head>
<body>
  <div id="root">
    <button id="probe" type="button">Workbench input probe</button>
    <div id="theme-probes">
      <div id="composer-probe" data-composer-card="true"><textarea placeholder="Composer placeholder"></textarea></div>
      <div data-question-key="qa-question"><section id="question-card-probe"><div role="radiogroup"><div id="question-answer-probe"><div aria-hidden="true"></div><textarea placeholder="Question placeholder"></textarea></div></div></section></div>
    </div>
  </div>
  <script>
    (() => {
      const qa = window.__wallpaperQa = {
        videos: [],
        canvases: [],
        drawCount: 0,
        pendingAnimationFrames: new Set(),
        cancelledAnimationFrames: 0,
        clicks: 0
      }
      document.querySelector('#probe').addEventListener('click', () => { qa.clicks += 1 })

      const nativeCreateElement = document.createElement.bind(document)
      document.createElement = (tagName, options) => {
        const element = nativeCreateElement(tagName, options)
        const normalized = String(tagName).toLowerCase()
        if (normalized === 'video') {
          element.__qaPendingVideoFrames = new Set()
          element.__qaCancelledVideoFrames = 0
          if (typeof element.requestVideoFrameCallback === 'function') {
            const nativeRequestVideoFrame = element.requestVideoFrameCallback.bind(element)
            const nativeCancelVideoFrame = element.cancelVideoFrameCallback.bind(element)
            Object.defineProperty(element, 'requestVideoFrameCallback', {
              configurable: true,
              value: callback => {
                let requestId = 0
                requestId = nativeRequestVideoFrame((now, metadata) => {
                  element.__qaPendingVideoFrames.delete(requestId)
                  callback(now, metadata)
                })
                element.__qaPendingVideoFrames.add(requestId)
                return requestId
              }
            })
            Object.defineProperty(element, 'cancelVideoFrameCallback', {
              configurable: true,
              value: requestId => {
                element.__qaPendingVideoFrames.delete(requestId)
                element.__qaCancelledVideoFrames += 1
                nativeCancelVideoFrame(requestId)
              }
            })
          }
          qa.videos.push(element)
        } else if (normalized === 'canvas') {
          element.__qaDrawCount = 0
          qa.canvases.push(element)
        }
        return element
      }

      const nativeDrawImage = CanvasRenderingContext2D.prototype.drawImage
      CanvasRenderingContext2D.prototype.drawImage = function (...args) {
        qa.drawCount += 1
        if (this.canvas) this.canvas.__qaDrawCount = (this.canvas.__qaDrawCount || 0) + 1
        return nativeDrawImage.apply(this, args)
      }

      const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window)
      const nativeCancelAnimationFrame = window.cancelAnimationFrame.bind(window)
      window.requestAnimationFrame = callback => {
        let requestId = 0
        requestId = nativeRequestAnimationFrame(now => {
          qa.pendingAnimationFrames.delete(requestId)
          callback(now)
        })
        qa.pendingAnimationFrames.add(requestId)
        return requestId
      }
      window.cancelAnimationFrame = requestId => {
        qa.pendingAnimationFrames.delete(requestId)
        qa.cancelledAnimationFrames += 1
        nativeCancelAnimationFrame(requestId)
      }

      const videoState = video => video ? {
        index: qa.videos.indexOf(video),
        connected: video.isConnected,
        paused: video.paused,
        attributeSrc: video.getAttribute('src'),
        currentSrc: video.currentSrc,
        sourceMarker: video.dataset.hdWallpaperSource || '',
        readyState: video.readyState,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        hasVideoFrameCallback: typeof video.requestVideoFrameCallback === 'function',
        pendingVideoFrames: video.__qaPendingVideoFrames?.size || 0,
        cancelledVideoFrames: video.__qaCancelledVideoFrames || 0,
        error: video.error ? { code: video.error.code, message: video.error.message || '' } : null
      } : null
      const canvasState = canvas => canvas ? {
        index: qa.canvases.indexOf(canvas),
        connected: canvas.isConnected,
        width: canvas.width,
        height: canvas.height,
        draws: canvas.__qaDrawCount || 0,
        pointerEvents: getComputedStyle(canvas).pointerEvents
      } : null

      const themeControlState = () => {
        const composer = document.querySelector('#composer-probe')
        const composerInput = composer.querySelector('textarea')
        const questionCard = document.querySelector('#question-card-probe')
        const questionAnswer = document.querySelector('#question-answer-probe')
        const placeholder = getComputedStyle(composerInput, '::placeholder')
        return {
          tone: document.documentElement.dataset.hdSkinTone || '',
          composerBackgroundImage: getComputedStyle(composer).backgroundImage,
          composerBackgroundColor: getComputedStyle(composer).backgroundColor,
          composerColor: getComputedStyle(composer).color,
          questionBackgroundImage: getComputedStyle(questionCard).backgroundImage,
          answerBackgroundImage: getComputedStyle(questionAnswer).backgroundImage,
          placeholderColor: placeholder.color,
          placeholderTextFill: placeholder.getPropertyValue('-webkit-text-fill-color')
        }
      }

      window.__wallpaperQaSnapshot = () => {
        const activeCanvas = document.querySelector('.hd-wallpaper-video')
        return {
          videoCount: qa.videos.length,
          canvasCount: qa.canvases.length,
          domVideoCount: document.querySelectorAll('video').length,
          drawCount: qa.drawCount,
          pendingAnimationFrames: qa.pendingAnimationFrames.size,
          cancelledAnimationFrames: qa.cancelledAnimationFrames,
          latestVideo: videoState(qa.videos.at(-1)),
          activeCanvas: canvasState(activeCanvas),
          clicks: qa.clicks,
          hidden: document.hidden,
          rootChildren: document.querySelector('#root')?.childElementCount || 0,
          themeControls: themeControlState()
        }
      }
      window.__wallpaperQaResourceState = (videoIndex, canvasIndex) => ({
        video: videoState(qa.videos[videoIndex]),
        canvas: canvasState(qa.canvases[canvasIndex]),
        pendingAnimationFrames: qa.pendingAnimationFrames.size,
        cancelledAnimationFrames: qa.cancelledAnimationFrames
      })
      window.__wallpaperQaClickProbe = () => {
        const button = document.querySelector('#probe')
        const rect = button.getBoundingClientRect()
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        hit?.click()
        const canvas = document.querySelector('.hd-wallpaper-video')
        return {
          hitProbe: hit === button,
          clicks: qa.clicks,
          canvasPointerEvents: canvas ? getComputedStyle(canvas).pointerEvents : ''
        }
      }
    })()
  </script>
</body>
</html>`
}

async function execute(window, source) {
  return window.webContents.executeJavaScript(source, true)
}

async function snapshot(window) {
  return execute(window, 'window.__wallpaperQaSnapshot()')
}

async function waitFor(window, label, predicate, timeout = 20_000) {
  const startedAt = Date.now()
  let current = null
  while (Date.now() - startedAt < timeout) {
    current = await snapshot(window)
    if (predicate(current)) return current
    await delay(100)
  }
  throw new Error(`${label} timed out after ${timeout} ms; last state=${JSON.stringify(current)}`)
}

function rendererMemory(window) {
  const pid = window.webContents.getOSProcessId()
  const metrics = app.getAppMetrics()
  const renderer = metrics.find(metric => metric.pid === pid)
  const gpu = metrics.find(metric => String(metric.type).toLowerCase() === 'gpu')
  return {
    pid,
    workingSetKB: renderer?.memory?.workingSetSize || 0,
    privateKB: renderer?.memory?.privateBytes || 0,
    gpuWorkingSetKB: gpu?.memory?.workingSetSize || 0,
    gpuPrivateKB: gpu?.memory?.privateBytes || 0
  }
}

async function run() {
  mkdirSync(tempRoot, { recursive: true })
  const htmlPath = path.join(tempRoot, 'wallpaper-lifecycle.html')
  writeFileSync(htmlPath, pageHtml(), 'utf8')

  let lifecycleState = Object.freeze({ phase: 'parked', reason: 'boot', seq: 0, at: Date.now() })
  let lifecycleQueries = 0
  ipcMain.handle('appearance:wallpaper-lifecycle:get', () => {
    lifecycleQueries += 1
    return lifecycleState
  })

  const window = new BrowserWindow({
    width: 960,
    height: 640,
    show: true,
    backgroundColor: '#172033',
    webPreferences: {
      preload: guestPreload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  })
  window.setMenuBarVisibility(false)

  let sequence = 0
  const publishLifecycle = (phase, reason) => {
    sequence += 1
    lifecycleState = Object.freeze({ phase, reason, seq: sequence, at: Date.now() })
    window.webContents.send(lifecycleChannel, lifecycleState)
    return lifecycleState
  }

  try {
    await window.loadFile(htmlPath)
    window.show()
    window.focus()
    await waitFor(window, 'visible workbench', state => !state.hidden && state.rootChildren > 0, 10_000)

    const { mobileBootstrapSource } = require(path.join(repoRoot, 'renderer', 'theme-integration.js'))
    const themeState = {
      themeId: 'custom',
      uiMode: 'aurora',
      reducedMotion: false,
      lowPerformance: false,
      customBackgroundDataUrl: '',
      customBackgroundVideoDataUrl: pathToFileURL(videoPath).href,
      customTheme: {
        mode: 'dark',
        accent: '#6f8cff',
        surface: '#171b29',
        text: '#f4f7ff',
        wallpaperBrightness: 84,
        wallpaperBlur: 22,
        glassTransparency: 100,
        borderStrength: 51,
        readabilityStrength: 43
      }
    }
    await execute(window, `window.__HARNESS_DESKTOP_THEME_STATE__ = ${JSON.stringify(themeState)}; window.__HARNESS_DESKTOP_THEMES__ = []; void ${mobileBootstrapSource}; true`)

    const queryDeadline = Date.now() + 5_000
    while (!lifecycleQueries && Date.now() < queryDeadline) await delay(25)
    assert.ok(lifecycleQueries > 0, 'guest preload must reconcile the current host lifecycle')
    await delay(150)
    const parkedAtBoot = await snapshot(window)
    assert.equal(parkedAtBoot.activeCanvas, null, 'parked boot must not retain a visible canvas')
    assert.equal(parkedAtBoot.domVideoCount, 0, 'decoder video must never enter the DOM')
    assert.equal(parkedAtBoot.themeControls.tone, 'dark')
    assert.match(parkedAtBoot.themeControls.composerBackgroundImage, /linear-gradient/i, 'custom composer must keep its readable theme surface')
    assert.match(parkedAtBoot.themeControls.questionBackgroundImage, /linear-gradient/i, 'question card must keep its readable theme surface')
    assert.match(parkedAtBoot.themeControls.answerBackgroundImage, /linear-gradient/i, 'free-text answer must keep its readable theme surface')
    assert.equal(parkedAtBoot.themeControls.composerColor, 'rgb(244, 247, 255)')
    assert.match(parkedAtBoot.themeControls.placeholderColor, /244,\s*247,\s*255/, 'placeholder must inherit the custom text palette')
    assert.match(parkedAtBoot.themeControls.placeholderTextFill, /244,\s*247,\s*255/, 'Chromium text fill must not keep the placeholder transparent')

    publishLifecycle('resumed', 'window-shown')
    let live = await waitFor(window, 'first continuously drawn wallpaper', state => (
      state.activeCanvas?.connected
      && state.activeCanvas.draws >= 4
      && state.latestVideo?.readyState >= 2
      && state.latestVideo.paused === false
    ))
    assert.equal(live.latestVideo.connected, false, 'decoder video must remain detached')
    assert.equal(live.domVideoCount, 0, 'there must be no visible video element')
    assert.equal(live.activeCanvas.pointerEvents, 'none', 'wallpaper canvas must not intercept input')
    assert.ok(live.activeCanvas.width * live.activeCanvas.height <= 1920 * 1080, 'canvas backing pixels must remain capped')

    const firstDrawCount = live.drawCount
    await delay(400)
    const laterFrame = await snapshot(window)
    assert.ok(laterFrame.drawCount >= firstDrawCount + 2, `wallpaper must continue drawing frames (${firstDrawCount} -> ${laterFrame.drawCount})`)

    const input = await execute(window, 'window.__wallpaperQaClickProbe()')
    assert.deepEqual(input, { hitProbe: true, clicks: 1, canvasPointerEvents: 'none' })

    const beforeForcedResume = live
    publishLifecycle('resumed', 'display-metrics-changed')
    live = await waitFor(window, 'forced resume replacement', state => (
      state.videoCount > beforeForcedResume.videoCount
      && state.canvasCount > beforeForcedResume.canvasCount
      && state.activeCanvas?.draws >= 2
    ))
    const forcedOld = await execute(window, `window.__wallpaperQaResourceState(${beforeForcedResume.latestVideo.index}, ${beforeForcedResume.activeCanvas.index})`)
    assert.equal(forcedOld.video.connected, false)
    assert.equal(forcedOld.video.paused, true)
    assert.equal(forcedOld.video.attributeSrc, null)
    assert.equal(forcedOld.video.sourceMarker, '')
    assert.equal(forcedOld.video.pendingVideoFrames, 0)
    if (forcedOld.video.hasVideoFrameCallback) assert.ok(forcedOld.video.cancelledVideoFrames >= 1, 'release must cancel the pending video frame callback')
    else assert.ok(forcedOld.cancelledAnimationFrames >= 1, 'release must cancel the RAF fallback')
    assert.deepEqual({ connected: forcedOld.canvas.connected, width: forcedOld.canvas.width, height: forcedOld.canvas.height }, { connected: false, width: 0, height: 0 })

    const memorySamples = []
    const cycleSummaries = []
    for (let index = 0; index < cycleCount; index += 1) {
      const beforePark = live
      publishLifecycle('parked', `cycle-${index + 1}-park`)
      await waitFor(window, `cycle ${index + 1} park`, state => state.activeCanvas === null)
      const released = await execute(window, `window.__wallpaperQaResourceState(${beforePark.latestVideo.index}, ${beforePark.activeCanvas.index})`)
      assert.equal(released.video.connected, false)
      assert.equal(released.video.paused, true)
      assert.equal(released.video.attributeSrc, null)
      assert.equal(released.video.sourceMarker, '')
      assert.equal(released.video.pendingVideoFrames, 0)
      if (released.video.hasVideoFrameCallback) assert.ok(released.video.cancelledVideoFrames >= 1, `cycle ${index + 1} must cancel the pending video frame callback`)
      else assert.ok(released.cancelledAnimationFrames >= 1, `cycle ${index + 1} must cancel the RAF fallback`)
      assert.deepEqual({ connected: released.canvas.connected, width: released.canvas.width, height: released.canvas.height }, { connected: false, width: 0, height: 0 })
      assert.equal(released.pendingAnimationFrames, 0)
      await delay(80)
      const memory = rendererMemory(window)
      memorySamples.push(memory)

      publishLifecycle('resumed', `cycle-${index + 1}-resume`)
      live = await waitFor(window, `cycle ${index + 1} resume`, state => (
        state.videoCount > beforePark.videoCount
        && state.canvasCount > beforePark.canvasCount
        && state.activeCanvas?.draws >= 2
        && state.latestVideo?.paused === false
        && state.latestVideo?.connected === false
      ))
      cycleSummaries.push({
        cycle: index + 1,
        videosCreated: live.videoCount,
        canvasesCreated: live.canvasCount,
        totalDraws: live.drawCount,
        memory
      })
    }

    const memoryValues = memorySamples.map(sample => sample.privateKB || sample.workingSetKB).filter(Boolean)
    const gpuMemoryValues = memorySamples.map(sample => sample.gpuPrivateKB || sample.gpuWorkingSetKB).filter(Boolean)
    assert.equal(memoryValues.length, cycleCount, 'renderer memory metrics must be available for every cycle')
    assert.equal(gpuMemoryValues.length, cycleCount, 'GPU memory metrics must be available for every cycle')
    const firstMemory = memoryValues[0]
    const finalMemory = memoryValues.at(-1)
    const spread = Math.max(...memoryValues) - Math.min(...memoryValues)
    const materialIncreases = memoryValues.slice(1).filter((value, index) => value > memoryValues[index] + 1024).length
    const firstGpuMemory = gpuMemoryValues[0]
    const finalGpuMemory = gpuMemoryValues.at(-1)
    const gpuSpread = Math.max(...gpuMemoryValues) - Math.min(...gpuMemoryValues)
    const gpuMaterialIncreases = gpuMemoryValues.slice(1).filter((value, index) => value > gpuMemoryValues[index] + 4096).length
    assert.ok(spread < 256 * 1024, `renderer memory spread is too large: ${spread} KB`)
    assert.ok(!(materialIncreases === memoryValues.length - 1 && finalMemory - firstMemory > 64 * 1024), `renderer memory grew materially on every cycle: ${firstMemory} -> ${finalMemory} KB`)
    assert.ok(gpuSpread < 256 * 1024, `GPU memory spread is too large: ${gpuSpread} KB`)
    assert.ok(!(gpuMaterialIncreases === gpuMemoryValues.length - 1 && finalGpuMemory - firstGpuMemory > 96 * 1024), `GPU memory grew materially on every cycle: ${firstGpuMemory} -> ${finalGpuMemory} KB`)

    return {
      ok: true,
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      video: { path: videoPath, bytes: statSync(videoPath).size },
      cycles: cycleCount,
      drawCount: live.drawCount,
      resourcesCreated: { videos: live.videoCount, canvases: live.canvasCount },
      themeControls: parkedAtBoot.themeControls,
      memory: {
        renderer: { firstKB: firstMemory, finalKB: finalMemory, spreadKB: spread, materialIncreases },
        gpu: { firstKB: firstGpuMemory, finalKB: finalGpuMemory, spreadKB: gpuSpread, materialIncreases: gpuMaterialIncreases },
        samples: memorySamples
      },
      cycleSummaries
    }
  } finally {
    ipcMain.removeHandler('appearance:wallpaper-lifecycle:get')
    if (!window.isDestroyed()) window.destroy()
  }
}

app.whenReady().then(run).then(report => {
  console.log(`WALLPAPER_LIFECYCLE_QA ${JSON.stringify(report)}`)
  app.exit(0)
}).catch(error => {
  console.error(`WALLPAPER_LIFECYCLE_QA_FAILED ${error?.stack || error}`)
  app.exit(1)
}).finally(() => {
  try { rmSync(tempRoot, { recursive: true, force: true }) } catch {}
})
