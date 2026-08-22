// Wallpaper Engine library discovery and one-click import support.
//
// Pure, dependency-injected helpers: all filesystem access goes through the
// `deps` object so behavior can be unit-tested without Electron. The main
// process wires real fs/registry access and keeps the manual project dialog
// as a fallback when no Steam library is found.
const path = require('node:path')

const WORKSHOP_CONTENT_ID = '431960'
const MAX_SCANNED_PROJECTS = 500
const MAX_TITLE_LENGTH = 160

// Well-known Steam install roots on Windows. The registry value (if any) is a
// stronger signal and is merged by the caller; these defaults cover the
// common Program Files and per-user install layouts.
function defaultSteamRootCandidates(env = process.env, platform = process.platform) {
  if (platform !== 'win32') return []
  const candidates = new Set()
  for (const variable of ['ProgramFiles(x86)', 'ProgramFiles']) {
    const root = env[variable]
    if (!root) continue
    candidates.add(path.join(root, 'Steam'))
  }
  const { LOCALAPPDATA, USERPROFILE } = env
  if (LOCALAPPDATA) {
    candidates.add(path.join(LOCALAPPDATA, 'Programs', 'Steam'))
    candidates.add(path.join(LOCALAPPDATA, 'Steam'))
  }
  if (USERPROFILE) candidates.add(path.join(USERPROFILE, 'Steam'))
  return [...candidates]
}

// Parse Valve's libraryfolders.vdf. Every mounted library root is recorded by
// its quoted "path" key, so wallpapers installed on secondary drives are found
// too. Unknown keys are ignored; malformed fragments contribute nothing.
function parseLibraryFolders(vdf) {
  const roots = []
  const quoted = /"path"\s+"((?:[^"\\]|\\.)*)"/gi
  let match
  while ((match = quoted.exec(String(vdf || '')))) {
    roots.push(match[1].replace(/\\(["\\])/g, '$1'))
  }
  return roots
}

// The two places Wallpaper Engine puts projects: the Steam Workshop content
// folder for subscribed wallpapers and the local install's projects folder.
function normalizeSteamRoot(value) {
  const resolved = path.resolve(String(value || '').trim())
  return path.basename(resolved).toLowerCase() === 'steamapps' ? path.dirname(resolved) : resolved
}

// Expand the primary Steam install into every library mounted through
// libraryfolders.vdf. Values ending in steamapps are normalized for older VDF
// layouts and test fixtures; duplicates are folded case-insensitively on Windows.
async function discoverSteamRoots(candidates, deps) {
  const roots = []
  const seen = new Set()
  function add(value) {
    if (!String(value || '').trim()) return
    const normalized = normalizeSteamRoot(value)
    const key = process.platform === 'win32' ? normalized.toLowerCase() : normalized
    if (seen.has(key)) return
    seen.add(key)
    roots.push(normalized)
  }
  for (const candidate of [].concat(candidates || [])) add(candidate)
  for (const root of roots.slice()) {
    try {
      const vdf = await deps.readFile(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8')
      for (const library of parseLibraryFolders(vdf)) add(library)
    } catch {
      // Missing/unreadable Steam metadata simply leaves the known candidates.
    }
  }
  return roots
}

function wallpaperEngineSearchRoots(steamRoots) {
  const searchRoots = []
  for (const root of [].concat(steamRoots || [])) {
    const value = String(root || '').trim()
    if (!value) continue
    searchRoots.push({
      kind: 'workshop',
      directory: path.join(value, 'steamapps', 'workshop', 'content', WORKSHOP_CONTENT_ID)
    })
    const local = path.join(value, 'steamapps', 'common', 'wallpaper_engine', 'projects')
    // Wallpaper Engine normally nests authored/default projects one level below
    // projects/, while some installations keep projects directly in that root.
    for (const directory of [local, path.join(local, 'myprojects'), path.join(local, 'defaultprojects')]) {
      searchRoots.push({ kind: 'projects', directory })
    }
  }
  return searchRoots
}

// Enumerate every project directory under the search roots and resolve each
// project.json. Unsupported (scene/web/application) projects are skipped with
// a counting reason so the UI can explain partial scans.
async function collectWallpaperEngineProjects(searchRoots, deps, resolveProject) {
  const projects = []
  const skipped = { missingProject: 0, unsupported: 0, unreadable: 0, media: 0 }
  for (const searchRoot of searchRoots) {
    if (projects.length >= MAX_SCANNED_PROJECTS) break
    let entries = []
    try {
      entries = await deps.readdir(searchRoot.directory)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (projects.length >= MAX_SCANNED_PROJECTS) break
      if (!entry || typeof entry.isDirectory !== 'function' || !entry.isDirectory()) continue
      const directory = path.join(searchRoot.directory, entry.name)
      const projectFile = path.join(directory, 'project.json')
      let resolution
      try {
        resolution = await resolveProject(projectFile)
      } catch (error) {
        const message = String(error?.message || '')
        if (error?.code === 'ENOENT' || /project\.json/i.test(message)) skipped.missingProject += 1
        else if (/仅支持 Wallpaper Engine 的图片和视频项目/.test(message)) skipped.unsupported += 1
        else if (/媒体格式不受支持/.test(message) || /媒体不是普通文件/.test(message)) skipped.media += 1
        else skipped.unreadable += 1
        continue
      }
      projects.push({
        directory,
        projectFile,
        file: resolution.file,
        kind: resolution.kind,
        title: String(resolution.title || path.basename(directory)).slice(0, MAX_TITLE_LENGTH),
        source: searchRoot.kind === 'workshop' ? 'workshop' : 'projects'
      })
    }
  }
  projects.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
  return { projects, skipped }
}

// Full library scan: derive the Steam roots from provided candidates, then
// collect resolvable image/video wallpaper projects.
async function scanWallpaperEngineLibrary(deps) {
  const steamRoots = await discoverSteamRoots(deps.steamRoots || [], deps)
  const searchRoots = wallpaperEngineSearchRoots(steamRoots)
  const collected = await collectWallpaperEngineProjects(searchRoots, deps, deps.resolveProject)
  return { roots: steamRoots, projects: collected.projects, skipped: collected.skipped }
}

module.exports = {
  WORKSHOP_CONTENT_ID,
  MAX_SCANNED_PROJECTS,
  defaultSteamRootCandidates,
  parseLibraryFolders,
  normalizeSteamRoot,
  discoverSteamRoots,
  wallpaperEngineSearchRoots,
  collectWallpaperEngineProjects,
  scanWallpaperEngineLibrary
}