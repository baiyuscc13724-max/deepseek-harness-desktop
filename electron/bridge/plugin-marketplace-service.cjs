const { mkdir, readFile, rename, rm, writeFile } = require('node:fs/promises')
const path = require('node:path')
const YAML = require('yaml')

const MARKETPLACE_ID = 'plugin-marketplace'
const MARKETPLACE_PACKAGE = 'dsh-plugin-marketplace'
const MARKETPLACE_REPOSITORY = 'bradeGithub/DSH-Plugins-Marketplace'
const MARKETPLACE_STATE_FILE = 'harness-desktop-marketplace.json'
const CHINESE_OVERLAY_MARKER = 'HARNESS_DESKTOP_AUTO_ZH_SUMMARY_V1'
const PATCH_OWNERSHIP_MARKER = 'HARNESS_DESKTOP_MARKETPLACE_PATCH_OWNER_V1'
const MARKETPLACE_RUNTIME_FILES = Object.freeze([
  'package.json',
  'LICENSE',
  'cordis.patch.yml',
  'adaptor.json',
  'registry.json',
  'skills.json',
  'lib/index.js',
  'lib/client.js',
  'lib/skin-manifest.js'
])

async function readText(file, fallback = '') {
  return readFile(file, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return fallback
    throw error
  })
}

async function readJson(file) {
  const text = await readText(file)
  if (!text) return null
  try { return JSON.parse(text) } catch { return null }
}

function repositoryIdentity(value) {
  const raw = typeof value === 'string' ? value : value?.url
  const match = String(raw || '').replace(/\.git$/i, '').match(/github\.com[/:]([^/]+\/[^/]+)$/i)
  return match ? match[1].toLowerCase() : ''
}

function versionParts(value) {
  const match = String(value || '').trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/)
  if (!match) return null
  return { numbers: match.slice(1, 4).map(Number), prerelease: match[4] || '' }
}

function compareVersions(left, right) {
  const a = versionParts(left)
  const b = versionParts(right)
  if (!a || !b) return 0
  for (let index = 0; index < 3; index += 1) {
    if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] < b.numbers[index] ? -1 : 1
  }
  if (a.prerelease === b.prerelease) return 0
  if (!a.prerelease) return 1
  if (!b.prerelease) return -1
  return a.prerelease.localeCompare(b.prerelease, 'en', { numeric: true })
}

async function atomicWriteText(file, text) {
  const temporary = `${file}.desktop-${process.pid}-${Date.now()}`
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  try {
    await writeFile(temporary, text, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, file)
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
  }
}

async function ensureProfilePatch(file) {
  const text = await readText(file, '[]\n')
  const document = YAML.parseDocument(text || '[]\n')
  if (document.errors.length) throw new Error(`DSH Web 配置补丁无法解析：${document.errors[0].message}`)
  const current = document.toJS()
  if (current == null) document.contents = document.createNode([])
  else if (!Array.isArray(current)) throw new Error('DSH Web 配置补丁必须是顶层数组。')
  document.contents.flow = false
  const matches = []
  if (YAML.isSeq(document.contents)) {
    document.contents.items.forEach((row, rowIndex) => {
      const insert = document.getIn([rowIndex, 'insert'], true)
      if (!YAML.isSeq(insert)) return
      insert.items.forEach((entry, entryIndex) => {
        if (!YAML.isMap(entry)) return
        if (entry.get('id') === MARKETPLACE_ID || entry.get('name') === MARKETPLACE_PACKAGE) {
          matches.push({ rowIndex, entryIndex, entry })
        }
      })
    })
  }

  let changed = false
  if (!matches.length) {
    document.add({ insert: [{ id: MARKETPLACE_ID, name: MARKETPLACE_PACKAGE, inject: ['webServer'] }] })
    changed = true
  } else {
    const [canonical, ...duplicates] = matches
    if (canonical.entry.get('id') !== MARKETPLACE_ID) {
      document.setIn([canonical.rowIndex, 'insert', canonical.entryIndex, 'id'], MARKETPLACE_ID)
      changed = true
    }
    if (canonical.entry.get('name') !== MARKETPLACE_PACKAGE) {
      document.setIn([canonical.rowIndex, 'insert', canonical.entryIndex, 'name'], MARKETPLACE_PACKAGE)
      changed = true
    }
    const inject = canonical.entry.get('inject', true)
    if (!YAML.isSeq(inject) || inject.items.length !== 1 || inject.items[0]?.value !== 'webServer') {
      document.setIn([canonical.rowIndex, 'insert', canonical.entryIndex, 'inject'], ['webServer'])
      changed = true
    }
    for (const duplicate of duplicates.reverse()) {
      document.deleteIn([duplicate.rowIndex, 'insert', duplicate.entryIndex])
      changed = true
    }
    for (let rowIndex = document.contents.items.length - 1; rowIndex >= 0; rowIndex -= 1) {
      const insert = document.getIn([rowIndex, 'insert'], true)
      if (!YAML.isSeq(insert) || insert.items.length !== 0) continue
      document.deleteIn([rowIndex, 'insert'])
      const row = document.getIn([rowIndex], true)
      if (YAML.isMap(row) && row.items.length === 0) document.deleteIn([rowIndex])
    }
  }
  if (!changed) return false
  await atomicWriteText(file, String(document))
  return true
}

async function removeProfileBundle(file) {
  const text = await readText(file)
  if (!text) return false
  let manifest
  try { manifest = JSON.parse(text) } catch {
    throw new Error('DSH Web profile package.json 无法解析。')
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('DSH Web profile package.json 必须是对象。')
  }
  if (manifest.dsh != null && (typeof manifest.dsh !== 'object' || Array.isArray(manifest.dsh))) {
    throw new Error('DSH Web profile 的 dsh 配置必须是对象。')
  }
  const dsh = manifest.dsh
  if (!dsh) return false
  if (dsh.profile != null && (typeof dsh.profile !== 'object' || Array.isArray(dsh.profile))) {
    throw new Error('DSH Web profile 配置必须是对象。')
  }
  const profile = dsh.profile
  if (!profile) return false
  if (profile.bundles != null && !Array.isArray(profile.bundles)) {
    throw new Error('DSH Web profile 的 bundles 必须是数组。')
  }
  if (!profile.bundles?.includes(MARKETPLACE_PACKAGE)) return false
  profile.bundles = profile.bundles.filter(name => name !== MARKETPLACE_PACKAGE)
  await atomicWriteText(file, `${JSON.stringify(manifest, null, 2)}\n`)
  return true
}

async function ensurePatchOwnershipCompatibility(destination) {
  const runtimeFile = path.join(destination, 'lib', 'index.js')
  const original = await readText(runtimeFile)
  if (!original) throw new Error('内置 DSH 插件市场缺少服务端入口。')
  if (original.includes(PATCH_OWNERSHIP_MARKER)) return false
  const cleanupAnchor = '  (async () => {\n    try {\n      const patchText = await readFile(PATCH_FILE, "utf8").catch(() => "");\n      if (patchText && hasPatchEntry(patchText, "dsh-plugin-marketplace")) {'
  if (!original.includes(cleanupAnchor)) {
    throw new Error('DSH 插件市场的注册自愈结构已变化，无法安全接管桌面版 patch。')
  }
  const replacement = `  // ${PATCH_OWNERSHIP_MARKER}\n` +
    '  if (process.env.HARNESS_DESKTOP_MARKETPLACE_PATCH_OWNER !== "1") (async () => {\n' +
    '    try {\n' +
    '      const patchText = await readFile(PATCH_FILE, "utf8").catch(() => "");\n' +
    '      if (patchText && hasPatchEntry(patchText, "dsh-plugin-marketplace")) {'
  await atomicWriteText(runtimeFile, original.replace(cleanupAnchor, replacement))
  return true
}

async function replaceDirectory(source, destination) {
  const temporary = `${destination}.desktop-${process.pid}-${Date.now()}`
  await rm(temporary, { recursive: true, force: true })
  for (const relative of MARKETPLACE_RUNTIME_FILES) {
    const from = path.join(source, ...relative.split('/'))
    const to = path.join(temporary, ...relative.split('/'))
    await mkdir(path.dirname(to), { recursive: true, mode: 0o700 })
    await writeFile(to, await readFile(from), { mode: 0o600 })
  }
  await rm(destination, { recursive: true, force: true })
  await rename(temporary, destination)
}

async function ensureChineseTranslationOverlay(destination) {
  const clientFile = path.join(destination, 'lib', 'client.js')
  const original = await readText(clientFile)
  if (!original) throw new Error('内置 DSH 插件市场缺少客户端入口。')
  if (original.includes(CHINESE_OVERLAY_MARKER)) return false

  const functionAnchor = '    function RepoCard(props) {'
  const repoAnchor = '      var repo = props.repo;'
  const descriptionAnchor = '            repo.description ? h("p", { style: s.desc }, repo.description) : null,'
  if (!original.includes(functionAnchor) || !original.includes(repoAnchor) || !original.includes(descriptionAnchor)) {
    throw new Error('DSH 插件市场客户端结构已变化，无法安全加入自动中文翻译。')
  }

  const translator = `    // ${CHINESE_OVERLAY_MARKER}\n` +
`    function automaticChineseDescription(repo) {\n` +
`      var source = String((repo && repo.description) || "").trim();\n` +
`      if (!source) return "";\n` +
`      if (/[\\u3400-\\u9fff]/.test(source)) return source;\n` +
`      var haystack = (source + " " + ((repo && repo.topics) || []).join(" ")).toLowerCase();\n` +
`      var rules = [\n` +
`        [/pdf|document|markdown|word|docx/, "文档处理"],\n` +
`        [/image|vision|photo|ocr|screenshot/, "图像与视觉处理"],\n` +
`        [/video|audio|speech|voice|subtitle/, "音视频处理"],\n` +
`        [/browser|scrap|crawl|website|web search/, "网页浏览与信息采集"],\n` +
`        [/github|gitlab|repository|pull request|code review/, "代码仓库协作"],\n` +
`        [/database|postgres|mysql|sqlite|sql|redis/, "数据库操作"],\n` +
`        [/excel|spreadsheet|csv|table/, "表格处理"],\n` +
`        [/powerpoint|presentation|slides|ppt/, "演示文稿制作"],\n` +
`        [/search|retrieval|rag|knowledge/, "搜索与知识检索"],\n` +
`        [/automat|workflow|schedule|task/, "自动化工作流"],\n` +
`        [/security|audit|vulnerab|scan/, "安全检查"],\n` +
`        [/test|debug|diagnos|monitor/, "测试与诊断"],\n` +
`        [/design|ui|ux|figma|frontend/, "界面与设计辅助"],\n` +
`        [/email|calendar|slack|discord|message/, "沟通与日程协作"],\n` +
`        [/cloud|deploy|docker|kubernetes|server/, "云服务与部署"],\n` +
`        [/finance|stock|crypto|payment/, "金融数据处理"]\n` +
`      ];\n` +
`      var capabilities = [];\n` +
`      rules.forEach(function (row) { if (row[0].test(haystack) && capabilities.indexOf(row[1]) < 0) capabilities.push(row[1]); });\n` +
`      capabilities = capabilities.slice(0, 4);\n` +
`      var kind = /skill/.test(haystack) ? "Skill" : (/mcp/.test(haystack) ? "MCP 扩展" : (/agent/.test(haystack) ? "AI Agent 扩展" : "开源插件"));\n` +
`      if (!capabilities.length) return "自动翻译：这是一个面向 DSH 与 AI Agent 的第三方" + kind + "，具体能力请查看项目原文。";\n` +
`      return "自动翻译：这是一个面向 DSH 与 AI Agent 的" + kind + "，主要用于" + capabilities.join("、") + "。";\n` +
`    }\n\n`;

  let next = original.replace(functionAnchor, `${translator}${functionAnchor}`)
  next = next.replace(repoAnchor, `${repoAnchor}\n      var translatedDescription = automaticChineseDescription(repo);`)
  next = next.replace(descriptionAnchor, `            translatedDescription ? h("div", null,\n              h("p", { style: s.desc, title: repo.description || "" }, translatedDescription),\n              translatedDescription !== repo.description ? h("details", { style: { marginTop: 5, color: "var(--dsw-alias-label-tertiary)", fontSize: 12 } },\n                h("summary", { style: { cursor: "pointer" } }, "查看英文原文"),\n                h("p", { style: Object.assign({}, s.desc, { marginTop: 5 }) }, repo.description)\n              ) : null\n            ) : null,`)
  await writeFile(clientFile, next, { encoding: 'utf8', mode: 0o600 })
  return true
}

async function ensurePluginMarketplace({ dshHome, bundledRoot }) {
  const home = path.resolve(dshHome)
  // Copy a fixed audited runtime file set with readFile instead of recursively
  // enumerating the package. Electron can read these paths directly from ASAR,
  // which keeps the large offline indexes compressed inside the application
  // boundary and avoids inflating app.asar.unpacked by the whole source tree.
  const source = path.resolve(bundledRoot)
  const profileRoot = path.join(home, 'profiles', 'web')
  const destination = path.join(profileRoot, 'node_modules', MARKETPLACE_PACKAGE)
  const stateFile = path.join(home, MARKETPLACE_STATE_FILE)
  const patchFile = path.join(profileRoot, 'cordis.patch.yml')
  const profileManifestFile = path.join(profileRoot, 'package.json')
  const bundledPackage = await readJson(path.join(source, 'package.json'))
  if (bundledPackage?.name !== MARKETPLACE_PACKAGE) throw new Error('内置 DSH 插件市场包无效。')
  const bundledRepository = repositoryIdentity(bundledPackage.repository)
  if (bundledRepository !== MARKETPLACE_REPOSITORY.toLowerCase()) throw new Error('内置 DSH 插件市场来源不匹配。')

  const installedPackage = await readJson(path.join(destination, 'package.json'))
  const state = await readJson(stateFile)
  let action = 'preserved'
  let warning = ''

  if (!installedPackage) {
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
    await replaceDirectory(source, destination)
    action = 'installed'
  } else {
    const installedRepository = repositoryIdentity(installedPackage.repository)
    if (installedRepository !== MARKETPLACE_REPOSITORY.toLowerCase()) {
      action = 'conflict'
      warning = `已存在同名插件，但来源是 ${installedRepository || '未知来源'}；桌面版未覆盖或激活它。`
    } else if (compareVersions(installedPackage.version, bundledPackage.version) < 0) {
      await replaceDirectory(source, destination)
      action = 'updated'
    }
  }

  if (action === 'conflict') {
    const installedClient = await readText(path.join(destination, 'lib', 'client.js'))
    return {
      action,
      warning,
      patchChanged: false,
      bundleRemoved: false,
      compatibilityReady: false,
      destination,
      translationReady: installedClient.includes(CHINESE_OVERLAY_MARKER),
      installedVersion: installedPackage?.version || null,
      bundledVersion: bundledPackage.version
    }
  }

  // The desktop ships the upstream package as a source dependency, so DSH's
  // installation-first bundle resolver would otherwise shadow a newer copy in
  // the user's profile. Desktop therefore owns exactly one registration path:
  // the profile patch. Patch the upstream self-cleaner first, remove any bundle
  // registration left by the official CLI, then add the idempotent user layer.
  await ensurePatchOwnershipCompatibility(destination)
  const bundleRemoved = await removeProfileBundle(profileManifestFile)
  const patchChanged = await ensureProfilePatch(patchFile)
  const currentPackage = await readJson(path.join(destination, 'package.json'))
  const managed = state?.managed === true || action === 'installed' || action === 'updated'
  const translationOverlayApplied = managed && compareVersions(currentPackage?.version, bundledPackage.version) <= 0
    ? await ensureChineseTranslationOverlay(destination)
    : false
  await mkdir(home, { recursive: true, mode: 0o700 })
  await writeFile(stateFile, `${JSON.stringify({
    schemaVersion: 1,
    managed: state?.managed === true || action === 'installed' || action === 'updated',
    installedVersion: currentPackage?.version || null,
    bundledVersion: bundledPackage.version,
    repository: MARKETPLACE_REPOSITORY,
    updatedAt: new Date().toISOString()
  }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })

  const installedClient = await readText(path.join(destination, 'lib', 'client.js'))
  return {
    action,
    warning,
    patchChanged,
    bundleRemoved,
    compatibilityReady: true,
    destination,
    translationReady: installedClient.includes(CHINESE_OVERLAY_MARKER),
    installedVersion: (await readJson(path.join(destination, 'package.json')))?.version || null,
    bundledVersion: bundledPackage.version
  }
}

module.exports = {
  MARKETPLACE_ID,
  MARKETPLACE_PACKAGE,
  MARKETPLACE_REPOSITORY,
  MARKETPLACE_RUNTIME_FILES,
  compareVersions,
  ensureChineseTranslationOverlay,
  ensurePatchOwnershipCompatibility,
  ensurePluginMarketplace,
  ensureProfilePatch,
  removeProfileBundle,
  repositoryIdentity
}
