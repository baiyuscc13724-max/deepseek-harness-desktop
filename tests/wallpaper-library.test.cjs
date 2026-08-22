const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, mkdir, writeFile, readdir, readFile, stat } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const { defaultSteamRootCandidates, parseLibraryFolders, discoverSteamRoots, wallpaperEngineSearchRoots, collectWallpaperEngineProjects, scanWallpaperEngineLibrary, WORKSHOP_CONTENT_ID } = require('../electron/bridge/wallpaper-library.cjs')
const { resolveWallpaperEngineProject } = require('../electron/bridge/wallpaper-service.cjs')

test('libraryfolders.vdf keeps every mounted Steam library path', () => {
  const vdf = `"libraryfolders"
{
	"0"
	{
		"path"		"C:\\Program Files (x86)\\Steam\\steamapps"
		"label"		""
		"contentid"		"1"
	}
	"1"
	{
		"path"		"D:\\SteamLibrary\\steamapps"
		"label"		"Games"
	}
}`
  assert.deepEqual(parseLibraryFolders(vdf), ['C:\\Program Files (x86)\\Steam\\steamapps', 'D:\\SteamLibrary\\steamapps'])
  assert.deepEqual(parseLibraryFolders('no paths here'), [])
})

test('default Steam root candidates cover common Windows installs', () => {
  const roots = defaultSteamRootCandidates({
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    ProgramFiles: 'C:\\Program Files',
    LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
    USERPROFILE: 'C:\\Users\\me'
  }, 'win32')
  assert.ok(roots.includes('C:\\Program Files (x86)\\Steam'))
  assert.ok(roots.includes('C:\\Program Files\\Steam'))
  assert.ok(roots.includes('C:\\Users\\me\\AppData\\Local\\Programs\\Steam'))
  assert.ok(roots.includes('C:\\Users\\me\\Steam'))
  assert.deepEqual(defaultSteamRootCandidates({}, 'darwin'), [])
})

test('Steam library discovery expands libraryfolders.vdf and normalizes steamapps paths', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-steam-root-'))
  const primary = path.join(root, 'primary')
  const secondary = path.join(root, 'secondary')
  await mkdir(path.join(primary, 'steamapps'), { recursive: true })
  await mkdir(path.join(secondary, 'steamapps'), { recursive: true })
  const encoded = secondary.replace(/\\/gu, '\\\\')
  await writeFile(path.join(primary, 'steamapps', 'libraryfolders.vdf'), `"libraryfolders"\n{\n "1" { "path" "${encoded}\\\\steamapps" }\n}`)
  const roots = await discoverSteamRoots([primary], { readFile })
  assert.deepEqual(roots, [path.resolve(primary), path.resolve(secondary)])
})

test('Wallpaper Engine search roots cover workshop and nested local projects per Steam install', () => {
  const roots = wallpaperEngineSearchRoots(['C:\\Steam'])
  const local = path.join('C:\\Steam', 'steamapps', 'common', 'wallpaper_engine', 'projects')
  assert.deepEqual(roots, [
    { kind: 'workshop', directory: path.join('C:\\Steam', 'steamapps', 'workshop', 'content', WORKSHOP_CONTENT_ID) },
    { kind: 'projects', directory: local },
    { kind: 'projects', directory: path.join(local, 'myprojects') },
    { kind: 'projects', directory: path.join(local, 'defaultprojects') }
  ])
})

test('library scan finds workshop and local image/video projects and skips unsupported scene projects', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-we-library-'))
  const workshop = path.join(root, 'steamapps', 'workshop', 'content', WORKSHOP_CONTENT_ID)
  const projects = path.join(root, 'steamapps', 'common', 'wallpaper_engine', 'projects')
  await mkdir(path.join(workshop, '1001'), { recursive: true })
  await writeFile(path.join(workshop, '1001', 'project.json'), JSON.stringify({ title: 'Aurora Loop', type: 'video', file: 'media.webm' }))
  await writeFile(path.join(workshop, '1001', 'media.webm'), 'video bytes')
  await mkdir(path.join(projects, 'my-scene'), { recursive: true })
  await writeFile(path.join(projects, 'my-scene', 'project.json'), JSON.stringify({ title: 'Scene', type: 'scene', file: 'scene.pkg' }))
  await mkdir(path.join(projects, 'still'), { recursive: true })
  await writeFile(path.join(projects, 'still', 'project.json'), JSON.stringify({ title: 'Still', type: 'image', file: 'art.png' }))
  await writeFile(path.join(projects, 'still', 'art.png'), 'image bytes')
  await mkdir(path.join(projects, 'myprojects', 'portrait'), { recursive: true })
  await writeFile(path.join(projects, 'myprojects', 'portrait', 'project.json'), JSON.stringify({ title: 'Tall Portrait', type: 'image', file: 'portrait.png' }))
  await writeFile(path.join(projects, 'myprojects', 'portrait', 'portrait.png'), 'portrait bytes')
  await mkdir(path.join(workshop, 'empty'), { recursive: true })

  const library = await scanWallpaperEngineLibrary({
    steamRoots: [root],
    readdir: directory => readdir(directory, { withFileTypes: true }),
    readFile: (file, encoding) => readFile(file, encoding),
    stat: file => stat(file),
    resolveProject: resolveWallpaperEngineProject
  })

  assert.deepEqual(library.roots, [root])
  assert.equal(library.projects.length, 3)
  const portrait = library.projects.find(project => project.title === 'Tall Portrait')
  assert.ok(portrait)
  assert.equal(portrait.directory, path.join(projects, 'myprojects', 'portrait'))
  const still = library.projects.find(project => project.title === 'Still')
  assert.ok(still)
  assert.equal(still.kind, 'image')
  assert.equal(still.source, 'projects')
  assert.equal(still.directory, path.join(projects, 'still'))
  const aurora = library.projects.find(project => project.title === 'Aurora Loop')
  assert.equal(aurora.kind, 'video')
  assert.equal(aurora.source, 'workshop')
  assert.deepEqual(library.skipped, { missingProject: 2, unsupported: 1, unreadable: 0, media: 0 })
})

test('collection is title-sorted and capped at the scanned project limit', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-we-limit-'))
  const workshop = path.join(root, 'steamapps', 'workshop', 'content', WORKSHOP_CONTENT_ID)
  const names = []
  for (let index = 0; index < 6; index += 1) {
    const name = String(index).padStart(3, '0')
    names.push(name)
    await mkdir(path.join(workshop, name), { recursive: true })
    await writeFile(path.join(workshop, name, 'project.json'), JSON.stringify({ title: `Item ${index}`, type: 'image', file: 'a.png' }))
    await writeFile(path.join(workshop, name, 'a.png'), 'x')
  }
  const readdirListing = async directory => readdir(directory, { withFileTypes: true })
  const collected = await collectWallpaperEngineProjects(
    [{ kind: 'workshop', directory: workshop }],
    { readdir: readdirListing, readFile: (file, encoding) => readFile(file, encoding), stat: file => stat(file) },
    resolveWallpaperEngineProject
  )
  assert.deepEqual(collected.projects.map(project => project.title).sort(), names.map((_, index) => `Item ${index}`))
  assert.equal(collected.projects.length, names.length)
})