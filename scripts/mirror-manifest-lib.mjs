function releaseVersion(release) {
  return String(release?.version || release?.tag_name || release?.name || '').trim().replace(/^v/i, '')
}

function releaseTag(release) {
  const value = String(release?.tag_name || '').trim()
  return value || `v${releaseVersion(release)}`
}

export function normalizeMirrorDefinitions(value) {
  const rows = Array.isArray(value) ? value : value?.mirrors
  if (!Array.isArray(rows)) return []
  return rows
    .filter(row => row?.enabled !== false)
    .map((row, index) => ({
      id: String(row?.id || `mirror-${index + 1}`).trim(),
      priority: Number.isFinite(Number(row?.priority)) ? Number(row.priority) : index + 1,
      urlTemplate: String(row?.urlTemplate || '').trim()
    }))
    .filter(row => row.id && row.urlTemplate)
    .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id))
}

export function renderMirrorUrl(template, release, fileName) {
  if (!template.includes('{file}') && !template.includes('{fileEncoded}')) {
    throw new Error('镜像 URL 模板必须包含 {file} 或 {fileEncoded}。')
  }
  const replacements = {
    '{version}': releaseVersion(release),
    '{tag}': releaseTag(release),
    '{file}': fileName,
    '{fileEncoded}': encodeURIComponent(fileName)
  }
  let rendered = template
  for (const [token, replacement] of Object.entries(replacements)) rendered = rendered.replaceAll(token, replacement)
  const url = new URL(rendered)
  if (url.protocol !== 'https:') throw new Error(`镜像 ${url.hostname || rendered} 必须使用 HTTPS。`)
  if (url.username || url.password) throw new Error('镜像 URL 不得包含账号或密码。')
  return url.toString()
}

export function addMirrorsToManifest(releases, definitions) {
  const cloned = structuredClone(releases)
  const list = Array.isArray(cloned) ? cloned : [cloned]
  const rows = normalizeMirrorDefinitions(definitions)
  if (!rows.length) throw new Error('没有启用的镜像 URL 模板。')
  for (const release of list) {
    if (!releaseVersion(release)) throw new Error('发布清单缺少 version 或 tag_name。')
    if (!Array.isArray(release?.assets)) continue
    for (const asset of release.assets) {
      const fileName = String(asset?.name || '').trim()
      if (!fileName) continue
      const generated = rows.map(row => renderMirrorUrl(row.urlTemplate, release, fileName))
      asset.mirror_urls = [...new Set([...generated, ...(Array.isArray(asset.mirror_urls) ? asset.mirror_urls : [])])]
    }
  }
  return Array.isArray(cloned) ? list : list[0]
}
