const test = require('node:test')
const assert = require('node:assert/strict')
const { copyFile, lstat, mkdtemp, mkdir, readFile, readdir, realpath, rename, symlink, unlink, writeFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const { normalizeState } = require('../electron/store/app-state-store.cjs')
const { MAX_WALLPAPER_LIBRARY_BYTES, assertWallpaperLibraryCapacity, cleanupOrphanedWallpaperStorage, createWallpaperMediaResponse, createWallpaperMutationQueue, createWallpaperVideoResponse, installManagedWallpaperCopy, parseByteRange, wallpaperKind, wallpaperLibraryMediaUrl, wallpaperMediaRevision, wallpaperMime, safeManagedWallpaperPath, safeProjectMediaPath, resolveWallpaperEngineInput, resolveWallpaperEngineProject, wallpaperStorageUsageBytes } = require('../electron/bridge/wallpaper-service.cjs')

test('wallpaper scheme privileges register before asynchronous Electron bootstrap', async () => {
  const bootstrap = await readFile(path.join(__dirname, '..', 'electron', 'bootstrap.cjs'), 'utf8')
  const main = await readFile(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
  const renderer = await readFile(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8')
  assert.match(bootstrap, /protocol\.registerSchemesAsPrivileged/)
  assert.match(bootstrap, /scheme: 'harness-wallpaper'/)
  assert.match(bootstrap, /bypassCSP: true/)
  assert.doesNotMatch(main, /protocol\.registerSchemesAsPrivileged/)
  assert.match(renderer, /img-src 'self' data: harness-wallpaper:/)
  assert.match(renderer, /media-src 'self' harness-wallpaper:/)
  assert.doesNotMatch(renderer, /(?:img-src|media-src)[^;]*\bfile:/)
})

test('wallpaper media types distinguish images and videos', () => {
  assert.equal(wallpaperKind('wallpaper.webp'), 'image')
  assert.equal(wallpaperKind('wallpaper.MP4'), 'video')
  assert.equal(wallpaperKind('scene.pkg'), null)
  assert.equal(wallpaperMime('movie.webm'), 'video/webm')
})

test('wallpaper library gives images and videos the same managed preview route', async () => {
  const info = { mtimeMs: 1234.6, size: 4096 }
  assert.equal(wallpaperMediaRevision(info), '1235-4096')
  assert.equal(wallpaperMediaRevision({ mtimeMs: -1, size: 4096 }), null)
  assert.equal(wallpaperMediaRevision({ mtimeMs: 1, size: -1 }), null)
  assert.equal(
    wallpaperLibraryMediaUrl('A-Managed-Video', info),
    'harness-wallpaper://library/a-managed-video/media?v=1235-4096'
  )
  assert.equal(wallpaperLibraryMediaUrl('../../secret', info), null)
  assert.equal(wallpaperLibraryMediaUrl('valid-id', { mtimeMs: 1, size: -1 }), null)

  const main = await readFile(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
  assert.match(main, /previewUrl:\s*available\s*\?\s*wallpaperLibraryMediaUrl\(item\.id, info\)\s*:\s*null/)
  assert.doesNotMatch(main, /previewUrl:\s*available\s*&&\s*item\.kind\s*===\s*['"]image['"]/)
  assert.match(main, /target\.searchParams\.get\('v'\) !== wallpaperMediaRevision\(info\)/)
  assert.match(main, /activeWallpaper\?\.previewUrl \|\| `\$\{WALLPAPER_SCHEME\}:\/\/current\/video\?v=\$\{wallpaperMediaRevision\(info\)\}`/)
})

test('Wallpaper Engine scan previews use opaque revision-bound media routes', async () => {
  const main = await readFile(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
  assert.match(main, /const wallpaperEnginePreviewFiles = new Map\(\)/)
  assert.match(main, /async function wallpaperEngineLibraryWithPreviews\(library\)/)
  assert.match(main, /createHash\('sha256'\)[\s\S]*?project\.projectFile[\s\S]*?project\.file[\s\S]*?\.slice\(0, 32\)/u)
  assert.match(main, /previewUrl: `\$\{WALLPAPER_SCHEME\}:\/\/engine-preview\/\$\{previewId\}\/media\?v=\$\{revision\}`/)
  assert.match(main, /target\.hostname === 'engine-preview'[\s\S]*?wallpaperEnginePreviewFiles\.get\(match\[1\]\.toLowerCase\(\)\)/u)
  assert.match(main, /expectedKind && kind !== expectedKind/)
  assert.match(main, /return wallpaperEngineLibraryWithPreviews\(library\)/)
  assert.doesNotMatch(main, /engine-preview\/\$\{encodeURIComponent\(project\.file\)\}/)
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
  assert.match(createWallpaperMediaResponse.toString(), /createReadStream/)
  assert.doesNotMatch(createWallpaperMediaResponse.toString(), /readFile/)
})

test('a missing Wallpaper Engine source does not invalidate its managed local copy', async () => {
  const themes = await mkdtemp(path.join(os.tmpdir(), 'harness-wallpaper-managed-'))
  const cachedFile = 'wallpaper-managed-copy.webp'
  await writeFile(path.join(themes, cachedFile), Buffer.from('local-copy'))
  const missingProject = path.join(themes, '..', 'wallpaper-engine-is-closed-and-source-is-missing')
  const state = normalizeState({ appearance: {
    themeId: 'custom',
    customTheme: { backgroundFile: cachedFile, wallpaperEngineProject: missingProject },
    wallpaperLibrary: { activeId: 'managed-copy', items: [{
      id: 'managed-copy', title: 'Offline wallpaper', kind: 'image', source: 'wallpaper-engine',
      cachedFile, projectDir: missingProject, sourceStatus: 'unavailable'
    }] }
  } })
  const item = state.appearance.wallpaperLibrary.items[0]
  assert.equal(item.sourceStatus, 'unavailable')
  const managed = safeManagedWallpaperPath(themes, item.cachedFile)
  assert.equal(managed, path.join(themes, cachedFile))
  const response = await createWallpaperMediaResponse(managed)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'image/webp')
  assert.equal(await response.text(), 'local-copy')
  assert.equal(safeManagedWallpaperPath(themes, '../../secret.webp'), null)
})

test('Wallpaper Engine import accepts local image/video projects only', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-wallpaper-'))
  await mkdir(path.join(root, 'assets'))
  await writeFile(path.join(root, 'assets', 'loop.mp4'), 'video')
  const project = path.join(root, 'project.json')
  await writeFile(project, JSON.stringify({ title: 'Loop', type: 'video', file: 'assets/loop.mp4' }))
  const [projectRoot, file] = await Promise.all([
    realpath(root),
    realpath(path.join(root, 'assets', 'loop.mp4'))
  ])
  const expected = { file, kind: 'video', title: 'Loop', projectRoot }
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

test('Wallpaper Engine path containment keeps the host platform case semantics', t => {
  if (process.platform === 'win32') return t.skip('Windows paths are case-insensitive.')
  const root = path.join(path.sep, 'tmp', 'HarnessWallpaperSafe')
  const project = path.join(root, 'project.json')
  assert.throws(() => safeProjectMediaPath(project, '../harnesswallpapersafe/clip.mp4'), /越过了项目目录/)
})

test('Wallpaper Engine media symlinks cannot escape the real project directory', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-wallpaper-symlink-'))
  const projectRoot = path.join(root, 'project')
  const outsideRoot = path.join(root, 'outside')
  await Promise.all([mkdir(projectRoot), mkdir(outsideRoot)])
  await writeFile(path.join(outsideRoot, 'escape.mp4'), 'video')
  try {
    await symlink(outsideRoot, path.join(projectRoot, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) return t.skip(`Symlinks are unavailable: ${error.code}`)
    throw error
  }
  const project = path.join(projectRoot, 'project.json')
  await writeFile(project, JSON.stringify({ title: 'Escape', type: 'video', file: 'linked/escape.mp4' }))
  await assert.rejects(resolveWallpaperEngineProject(project), /真实路径越过了项目目录/)
})

test('Wallpaper Engine media symlinks remain valid when their real target stays inside the project', async t => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'harness-wallpaper-contained-symlink-'))
  const assets = path.join(projectRoot, 'assets')
  await mkdir(assets)
  const media = path.join(assets, 'loop.mp4')
  await writeFile(media, 'video')
  try {
    await symlink(assets, path.join(projectRoot, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) return t.skip(`Symlinks are unavailable: ${error.code}`)
    throw error
  }
  const project = path.join(projectRoot, 'project.json')
  await writeFile(project, JSON.stringify({ title: 'Contained', type: 'video', file: 'linked/loop.mp4' }))
  const resolution = await resolveWallpaperEngineProject(project)
  assert.equal(resolution.file, await realpath(media))
  assert.equal(resolution.projectRoot, await realpath(projectRoot))
})

test('wallpaper library quota uses the replacement final state for imports and syncs', async () => {
  const gib = 1024 * 1024 * 1024
  const items = [{ id: 'other' }, { id: 'active' }]
  const rejectedSizes = new Map([['other', 7 * gib], ['active', 0.5 * gib]])
  await assert.rejects(assertWallpaperLibraryCapacity(items, {
    replacingId: 'active',
    incomingBytes: 2 * gib,
    sizeOf: item => rejectedSizes.get(item.id)
  }), /8 GB/)

  const allowedBytes = await assertWallpaperLibraryCapacity(items, {
    replacingId: 'active',
    incomingBytes: 1 * gib,
    sizeOf: item => rejectedSizes.get(item.id)
  })
  assert.equal(allowedBytes, MAX_WALLPAPER_LIBRARY_BYTES)

  const main = await readFile(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
  assert.match(main, /syncBoundWallpaperEngine[\s\S]*?beforeCopy: \(info, context\) => assertManagedWallpaperLibraryCapacity\(appearance\.wallpaperLibrary, active\?\.id, info\.size, context\?\.temporaryFile\)/)
  assert.match(main, /importWallpaperRecord[\s\S]*?beforeCopy: \(info, context\) => assertManagedWallpaperLibraryCapacity\(library, existing\?\.id, info\.size, context\?\.temporaryFile\)/)
})

test('restart cleanup removes only unreferenced controlled wallpaper files and counts locked orphans', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'harness-wallpaper-restart-cleanup-'))
  const active = 'wallpaper-active.webp'
  const orphan = 'wallpaper-orphan.webp'
  const temporary = '.wallpaper-crash.webp.123e4567-e89b-42d3-a456-426614174000.tmp'
  await Promise.all([
    writeFile(path.join(directory, active), 'active'),
    writeFile(path.join(directory, orphan), 'locked-orphan'),
    writeFile(path.join(directory, temporary), 'partial'),
    writeFile(path.join(directory, 'notes.txt'), 'keep')
  ])
  assert.equal(await wallpaperStorageUsageBytes(directory), Buffer.byteLength('active') + Buffer.byteLength('locked-orphan') + Buffer.byteLength('partial'))
  await assert.rejects(wallpaperStorageUsageBytes(directory, {}, {
    lstat: async () => {
      const error = new Error('unreadable')
      error.code = 'EACCES'
      throw error
    }
  }), { code: 'EACCES' })

  const firstPass = await cleanupOrphanedWallpaperStorage(directory, [active], {
    unlink: async file => {
      if (path.basename(file) === orphan) {
        const error = new Error('locked')
        error.code = 'EPERM'
        throw error
      }
      await unlink(file)
    }
  })
  assert.deepEqual(firstPass.deleted, [temporary])
  assert.deepEqual(firstPass.failed, [orphan])
  assert.equal(await wallpaperStorageUsageBytes(directory), Buffer.byteLength('active') + Buffer.byteLength('locked-orphan'))

  const restartPass = await cleanupOrphanedWallpaperStorage(directory, [active])
  assert.deepEqual(restartPass.deleted, [orphan])
  assert.deepEqual(restartPass.failed, [])
  assert.deepEqual((await readdir(directory)).sort(), [active, 'notes.txt'].sort())
  assert.equal(await wallpaperStorageUsageBytes(directory), Buffer.byteLength('active'))
  const main = await readFile(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
  assert.match(main, /app\.whenReady\(\)[\s\S]*?await cleanupOrphanedWallpaperAssets\(\)[\s\S]*?await registerWallpaperProtocol\(\)/)
})

test('managed wallpaper copy rechecks the copied size when the source grows during copy', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-wallpaper-copy-growth-'))
  const source = path.join(root, 'source.webp')
  const directory = path.join(root, 'managed')
  await writeFile(source, 'ok')
  let finalized = false
  await assert.rejects(installManagedWallpaperCopy({
    source,
    directory,
    fileName: 'wallpaper-copy-growth.webp',
    expectedKind: 'image',
    maximumBytes: 5,
    beforeFinalize: () => { finalized = true }
  }, {
    copyFile: async (_source, temporaryFile) => {
      await writeFile(source, 'source-grew')
      await writeFile(temporaryFile, 'copied-grew')
    }
  }), /图片壁纸必须小于 50 MB/)
  assert.equal(finalized, false)
  assert.deepEqual(await readdir(directory), [])
})

test('managed wallpaper copy applies library quota to the completed temporary copy', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-wallpaper-copy-quota-'))
  const source = path.join(root, 'source.webp')
  const directory = path.join(root, 'managed')
  await writeFile(source, 'ok')
  let observedBytes = 0
  await assert.rejects(installManagedWallpaperCopy({
    source,
    directory,
    fileName: 'wallpaper-copy-quota.webp',
    expectedKind: 'image',
    maximumBytes: 50,
    beforeFinalize: async info => {
      observedBytes = info.size
      await assertWallpaperLibraryCapacity([{ id: 'other' }], {
        incomingBytes: info.size,
        sizeOf: () => MAX_WALLPAPER_LIBRARY_BYTES - 5
      })
    }
  }, {
    copyFile: async (_source, temporaryFile) => {
      await writeFile(source, 'source-grew')
      await writeFile(temporaryFile, 'copied-grew')
    }
  }), /8 GB/)
  assert.equal(observedBytes, Buffer.byteLength('copied-grew'))
  assert.deepEqual(await readdir(directory), [])
})

test('managed wallpaper copy removes a partial temporary file after copy failure', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-wallpaper-copy-failure-'))
  const source = path.join(root, 'source.webp')
  const directory = path.join(root, 'managed')
  await writeFile(source, 'source')
  await assert.rejects(installManagedWallpaperCopy({
    source,
    directory,
    fileName: 'wallpaper-copy-failure.webp',
    expectedKind: 'image',
    maximumBytes: 50
  }, {
    copyFile: async (_source, temporaryFile) => {
      await writeFile(temporaryFile, 'partial')
      throw new Error('simulated copy failure')
    }
  }), /simulated copy failure/)
  assert.deepEqual(await readdir(directory), [])
})

test('managed wallpaper copy removes the final file if rename reports a late failure', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-wallpaper-rename-failure-'))
  const source = path.join(root, 'source.webp')
  const directory = path.join(root, 'managed')
  await writeFile(source, 'source')
  await assert.rejects(installManagedWallpaperCopy({
    source,
    directory,
    fileName: 'wallpaper-rename-failure.webp',
    expectedKind: 'image',
    maximumBytes: 50
  }, {
    rename: async (temporaryFile, finalFile) => {
      await rename(temporaryFile, finalFile)
      throw new Error('simulated late rename failure')
    }
  }), /simulated late rename failure/)
  assert.deepEqual(await readdir(directory), [])
})

test('managed wallpaper copy atomically renames a validated temporary file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-wallpaper-copy-success-'))
  const source = path.join(root, 'source.webp')
  const directory = path.join(root, 'managed')
  const fileName = 'wallpaper-atomic-success.webp'
  await writeFile(source, 'complete')
  let renameObserved = false
  const result = await installManagedWallpaperCopy({
    source,
    directory,
    fileName,
    expectedKind: 'image',
    maximumBytes: 50,
    beforeFinalize: info => assert.equal(info.size, Buffer.byteLength('complete'))
  }, {
    copyFile,
    rename: async (temporaryFile, finalFile) => {
      assert.match(path.basename(temporaryFile), /^\.wallpaper-atomic-success\.webp\..+\.tmp$/)
      await assert.rejects(lstat(finalFile), { code: 'ENOENT' })
      assert.equal(await readFile(temporaryFile, 'utf8'), 'complete')
      renameObserved = true
      await rename(temporaryFile, finalFile)
    }
  })
  assert.equal(renameObserved, true)
  assert.equal(result.fileName, fileName)
  assert.equal(await readFile(result.file, 'utf8'), 'complete')
  assert.deepEqual(await readdir(directory), [fileName])
})

test('wallpaper mutation queue serializes real Promise.all imports and preserves item and byte limits', async () => {
  const queue = createWallpaperMutationQueue()
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-wallpaper-concurrent-import-'))
  const directory = path.join(root, 'managed')
  await Promise.all([
    writeFile(path.join(root, 'first.webp'), 'first'),
    writeFile(path.join(root, 'second.webp'), 'second')
  ])
  let items = []
  const importItem = id => queue.run(async () => {
    const snapshot = [...items]
    const installed = await installManagedWallpaperCopy({
      source: path.join(root, `${id}.webp`),
      directory,
      fileName: `wallpaper-${id}.webp`,
      expectedKind: 'image',
      maximumBytes: 50
    })
    await new Promise(resolve => setTimeout(resolve, 2))
    items = [...snapshot, { id, bytes: installed.info.size, cachedFile: installed.fileName }]
  })
  await Promise.all([importItem('first'), importItem('second')])
  assert.deepEqual(items.map(item => item.id), ['first', 'second'])
  assert.deepEqual((await readdir(directory)).sort(), ['wallpaper-first.webp', 'wallpaper-second.webp'])

  items = Array.from({ length: 47 }, (_value, index) => ({ id: `existing-${index}`, bytes: 0 }))
  const importWithItemLimit = id => queue.run(async () => {
    const snapshot = [...items]
    if (snapshot.length >= 48) throw new Error('item limit')
    await new Promise(resolve => setTimeout(resolve, 2))
    items = [...snapshot, { id, bytes: 0 }]
  })
  const itemResults = await Promise.allSettled([importWithItemLimit('limit-a'), importWithItemLimit('limit-b')])
  assert.equal(itemResults.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(itemResults.filter(result => result.status === 'rejected').length, 1)
  assert.equal(items.length, 48)

  items = [{ id: 'base', bytes: MAX_WALLPAPER_LIBRARY_BYTES - 10 }]
  const importWithByteLimit = id => queue.run(async () => {
    const snapshot = [...items]
    await assertWallpaperLibraryCapacity(snapshot, { incomingBytes: 6, sizeOf: item => item.bytes })
    await new Promise(resolve => setTimeout(resolve, 2))
    items = [...snapshot, { id, bytes: 6 }]
  })
  const byteResults = await Promise.allSettled([importWithByteLimit('bytes-a'), importWithByteLimit('bytes-b')])
  assert.equal(byteResults.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(byteResults.filter(result => result.status === 'rejected').length, 1)
  assert.equal(items.length, 2)
  assert.equal(items.reduce((sum, item) => sum + item.bytes, 0), MAX_WALLPAPER_LIBRARY_BYTES - 4)

  const main = await readFile(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
  for (const wrapper of ['syncBoundWallpaperEngine', 'importWallpaperRecord', 'applyWallpaperLibraryItem', 'deleteWallpaperLibraryItem', 'removeCustomThemeBackground', 'cleanupOrphanedWallpaperAssets']) {
    assert.match(main, new RegExp(`async function ${wrapper}\\([^)]*\\) \\{[\\s\\S]*?wallpaperMutationQueue\\.run`))
  }
})
