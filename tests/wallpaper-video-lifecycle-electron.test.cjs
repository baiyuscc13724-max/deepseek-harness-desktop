const assert = require('node:assert/strict')
const { existsSync, readFileSync } = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const test = require('node:test')

const repoRoot = path.resolve(__dirname, '..')
const fixture = path.join(__dirname, 'fixtures', 'wallpaper-video-lifecycle-electron.cjs')
const defaultVideo = path.join(repoRoot, '.artifacts', 'wallpaper-ui-qa-20260823', 'themes', 'wallpaper-661c1687-8193-40e8-88d3-a9ee8d0f0bc8.mp4')
const source = readFileSync(fixture, 'utf8')

test('Electron wallpaper lifecycle fixture exercises the real compositor and media release path', () => {
  assert.match(source, /renderer', 'theme-integration\.js'/)
  assert.match(source, /electron', 'guest-preload\.cjs'/)
  assert.match(source, /mobileBootstrapSource/)
  assert.match(source, /appearance:wallpaper-lifecycle/)
  assert.match(source, /domVideoCount/)
  assert.match(source, /pendingVideoFrames/)
  assert.match(source, /attributeSrc, null/)
  assert.match(source, /width: 0, height: 0/)
  assert.match(source, /cycleCount >= 10/)
  assert.match(source, /elementFromPoint/)
  assert.match(source, /getAppMetrics\(\)/)
  assert.match(source, /data-composer-card="true"/)
  assert.match(source, /data-question-key="qa-question"/)
  assert.match(source, /placeholderTextFill/)
  assert.match(source, /questionBackgroundImage/)
  assert.doesNotMatch(source, /(?:location|webContents)\.reload\(/)
})

test('Electron 43 repeatedly parks and recreates a real video wallpaper without leaking the visible plane', {
  skip: process.env.HARNESS_WALLPAPER_ELECTRON_INTEGRATION !== '1'
}, context => {
  const video = path.resolve(process.env.HARNESS_WALLPAPER_STRESS_VIDEO || defaultVideo)
  if (!existsSync(video)) {
    context.skip(`stress video is unavailable: ${video}`)
    return
  }

  const electronBinary = require('electron')
  const environment = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  const result = spawnSync(electronBinary, [fixture, '--video', video, '--cycles', '10'], {
    cwd: repoRoot,
    env: environment,
    stdio: 'inherit',
    timeout: 120_000,
    windowsHide: false
  })
  assert.equal(result.error, undefined, result.error?.message)
  assert.equal(result.signal, null, `Electron fixture terminated by ${result.signal}`)
  assert.equal(result.status, 0, `Electron fixture exited with ${result.status}`)
})
