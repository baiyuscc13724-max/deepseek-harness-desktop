const { readFile } = require('node:fs/promises')

function normalizeFeedUrls(value) {
  const rows = Array.isArray(value) ? value : value?.feeds
  if (!Array.isArray(rows)) return []
  return [...new Set(rows.map(item => String(item || '').trim()).filter(Boolean).map(item => {
    const url = new URL(item)
    if (url.protocol !== 'https:') throw new Error('更新清单地址必须使用 HTTPS。')
    if (url.username || url.password) throw new Error('更新清单地址不得包含账号或密码。')
    if (url.hash) throw new Error('更新清单地址不得包含片段。')
    if (url.port && url.port !== '443') throw new Error('更新清单地址不得使用非标准 HTTPS 端口。')
    return url.toString()
  }))]
}

async function resolveUpdateFeeds({ environment = process.env, configPaths = [], fallback = [] } = {}) {
  const configured = String(environment.HARNESS_DESKTOP_UPDATE_FEEDS || environment.HARNESS_DESKTOP_UPDATE_FEED || '').trim()
  if (configured) return normalizeFeedUrls(configured.split(/[;,\r\n]+/))

  for (const configPath of configPaths) {
    try {
      const payload = JSON.parse(await readFile(configPath, 'utf8'))
      const urls = normalizeFeedUrls(payload)
      if (urls.length) return urls
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw new Error(`更新源配置无效：${error.message}`)
    }
  }
  return normalizeFeedUrls(fallback)
}

module.exports = { normalizeFeedUrls, resolveUpdateFeeds }
