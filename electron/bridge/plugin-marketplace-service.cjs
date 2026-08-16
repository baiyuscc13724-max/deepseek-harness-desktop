const { cp, mkdir, readFile, rename, rm, writeFile } = require('node:fs/promises')
const path = require('node:path')
const YAML = require('yaml')
const { physicalUnpackedPath } = require('./dsh-resolver.cjs')

const MARKETPLACE_ID = 'plugin-marketplace'
const MARKETPLACE_PACKAGE = 'dsh-plugin-marketplace'
const MARKETPLACE_REPOSITORY = 'bradeGithub/DSH-Plugins-Marketplace'
const MARKETPLACE_STATE_FILE = 'harness-desktop-marketplace.json'
const CHINESE_OVERLAY_MARKER = 'HARNESS_DESKTOP_AUTO_ZH_SUMMARY_V1'

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

function hasMarketplaceEntry(document) {
  const rows = document.toJS() || []
  if (!Array.isArray(rows)) return false
  return rows.some(row => Array.isArray(row?.insert) && row.insert.some(item => item?.id === MARKETPLACE_ID || item?.name === MARKETPLACE_PACKAGE))
}

async function ensureProfilePatch(file) {
  const text = await readText(file, '[]\n')
  const document = YAML.parseDocument(text || '[]\n')
  if (document.errors.length) throw new Error(`DSH Web 配置补丁无法解析：${document.errors[0].message}`)
  if (hasMarketplaceEntry(document)) return false
  const current = document.toJS()
  if (current == null) document.contents = document.createNode([])
  else if (!Array.isArray(current)) throw new Error('DSH Web 配置补丁必须是顶层数组。')
  document.contents.flow = false
  document.add({ insert: [{ id: MARKETPLACE_ID, name: MARKETPLACE_PACKAGE }] })
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  await writeFile(file, String(document), { encoding: 'utf8', mode: 0o600 })
  return true
}

async function replaceDirectory(source, destination) {
  const temporary = `${destination}.desktop-${process.pid}-${Date.now()}`
  await rm(temporary, { recursive: true, force: true })
  await cp(source, temporary, { recursive: true, force: true })
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
  // electron-builder keeps node_modules in app.asar.unpacked. Electron can
  // read individual files through the app.asar virtual path, but fs.cp cannot
  // enumerate a directory there. Always move to the physical unpacked tree
  // before copying the bundled marketplace into a fresh user's DSH profile.
  const source = path.resolve(physicalUnpackedPath(path.resolve(bundledRoot)))
  const profileRoot = path.join(home, 'profiles', 'web')
  const destination = path.join(profileRoot, 'node_modules', MARKETPLACE_PACKAGE)
  const stateFile = path.join(home, MARKETPLACE_STATE_FILE)
  const patchFile = path.join(profileRoot, 'cordis.patch.yml')
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
    if (installedRepository && installedRepository !== MARKETPLACE_REPOSITORY.toLowerCase()) {
      action = 'conflict'
      warning = `已存在同名插件，但来源是 ${installedRepository}；桌面版未覆盖它。`
    } else if (state?.managed === true && compareVersions(installedPackage.version, bundledPackage.version) < 0) {
      await replaceDirectory(source, destination)
      action = 'updated'
    }
  }

  const patchChanged = await ensureProfilePatch(patchFile)
  if (action !== 'conflict') {
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
  }

  const installedClient = await readText(path.join(destination, 'lib', 'client.js'))
  return {
    action,
    warning,
    patchChanged,
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
  compareVersions,
  ensureChineseTranslationOverlay,
  ensurePluginMarketplace,
  ensureProfilePatch,
  repositoryIdentity
}
