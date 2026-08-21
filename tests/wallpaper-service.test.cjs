const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, mkdir, readFile, writeFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const { createWallpaperVideoResponse, parseByteRange, wallpaperKind, wallpaperMime, safeProjectMediaPath, resolveWallpaperEngineInput, resolveWallpaperEngineProject } = require('../electron/bridge/wallpaper-service.cjs')

test('wallpaper scheme privileges register before asynchronous Electron bootstrap', async () => {
  const bootstrap = await readFile(path.join(__dirname, '..', 'electron', 'bootstrap.cjs'), 'utf8')
  const main = await readFile(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
  assert.match(bootstrap, /protocol\.registerSchemesAsPrivileged/)
  assert.match(bootstrap, /scheme: 'harness-wallpaper'/)
  assert.match(bootstrap, /bypassCSP: true/)
  assert.doesNotMatch(main, /protocol\.registerSchemesAsPrivileged/)
})

test('wallpaper media types distinguish images and videos', () => {
  assert.equal(wallpaperKind('wallpaper.webp'), 'image')
  assert.equal(wallpaperKind('wallpaper.MP4'), 'video')
  assert.equal(wallpaperKind('scene.pkg'), null)
  assert.equal(wallpaperMime('movie.webm'), 'video/webm')
})

test('video responses stream exact byte ranges with the correct MIME type', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-wallpaper-range-'))
  const video = path.join(root, 'clip.mp4')
  await writeFile(video, Buffer.from('0123456789'))
  const response = await createWallpaperVideoResponse(video, { headers: new Headers({ range: 'bytes=2-5' }) })
  assert.equal(response.status, 206)
  assert.equal(response.headers.get('accept-ranges'), 'bytes')
  assert.equal(response.headers.get('content-range'), 'bytes 2-5/10')
  assert.equal(response.headers.get('content-type'), 'video/mp4')
  assert.equal(response.headers.get('content-length'), '4')
  assert.equal(await response.text(), '2345')
  assert.deepEqual(parseByteRange('bytes=-3', 10), { start: 7, end: 9 })
  const invalid = await createWallpaperVideoResponse(video, { headers: new Headers({ range: 'bytes=99-100' }) })
  assert.equal(invalid.status, 416)
  assert.match(createWallpaperVideoResponse.toString(), /createReadStream/)
  assert.doesNotMatch(createWallpaperVideoResponse.toString(), /readFile/)
})

test('Wallpaper Engine import accepts local image/video projects only', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-wallpaper-'))
  await mkdir(path.join(root, 'assets'))
  await writeFile(path.join(root, 'assets', 'loop.mp4'), 'video')
  const project = path.join(root, 'project.json')
  await writeFile(project, JSON.stringify({ title: 'Loop', type: 'video', file: 'assets/loop.mp4' }))
  const expected = { file: path.join(root, 'assets', 'loop.mp4'), kind: 'video', title: 'Loop' }
  assert.deepEqual(await resolveWallpaperEngineProject(project), expected)
  assert.deepEqual(await resolveWallpaperEngineInput(root), expected)
  assert.deepEqual(await resolveWallpaperEngineInput(project), expected)
  await writeFile(project, JSON.stringify({ type: 'scene', file: 'scene.pkg' }))
  await assert.rejects(resolveWallpaperEngineProject(project), /仅支持 Wallpaper Engine 的图片和视频项目/)
})

test('Wallpaper Engine media cannot escape the project directory', () => {
  const windows = process.platform === 'win32'
  const project = windows
    ? path.win32.join('C:\\wallpapers\\safe', 'project.json')
    : path.join(path.sep, 'wallpapers', 'safe', 'project.json')
  const escape = windows ? '..\\secret.mp4' : '../secret.mp4'
  assert.throws(() => safeProjectMediaPath(project, escape), /越过了项目目录/)
})
