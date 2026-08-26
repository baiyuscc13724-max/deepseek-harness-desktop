const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { readFile } = require('node:fs/promises')

const root = path.join(__dirname, '..')

async function readRelayFiles() {
  const [html, renderer, styles, preload] = await Promise.all([
    readFile(path.join(root, 'renderer', 'index.html'), 'utf8'),
    readFile(path.join(root, 'renderer', 'app.js'), 'utf8'),
    readFile(path.join(root, 'renderer', 'styles.css'), 'utf8'),
    readFile(path.join(root, 'electron', 'preload.cjs'), 'utf8')
  ])
  return { html, renderer, styles, preload }
}

test('mobile sync dialog has an always-visible personal relay server card', async () => {
  const { html, renderer } = await readRelayFiles()

  // 卡片元素齐全
  for (const id of ['mobileRelayTitle', 'mobileRelayStatus', 'mobileRelayUrl', 'mobileRelaySave', 'mobileRelayClear', 'mobileRelayMessage']) {
    assert.match(html, new RegExp(`id="${id}"`), `missing relay card element ${id}`)
  }
  assert.match(html, /class="mobile-sync-relay-card"/u)

  // 始终可见：卡片位于可用内容（running 时才显示）之外
  const cardIndex = html.indexOf('mobile-sync-relay-card')
  const enabledContentIndex = html.indexOf('id="mobileSyncEnabledContent"')
  assert.ok(cardIndex !== -1 && enabledContentIndex !== -1, 'relay card or enabled content missing')
  assert.ok(cardIndex < enabledContentIndex, 'relay card must be visible even when sync is off')

  // 按钮与被锁定的文案
  assert.match(html, /检测并保存/u)
  assert.match(html, /清除（恢复默认）/u)
  assert.match(html, /域名、公网 IP 或 wss:\/\/ 地址/u)
  assert.match(html, /203\.0\.113\.10/u)
  assert.match(renderer, /请先输入中继服务器域名、公网 IP 或 wss:\/\/ 地址/u)

  // 提示：可信 TLS、443、手机从二维码自动取得配置
  assert.match(html, /可信 TLS 证书/u)
  assert.match(html, /443 端口/u)
  assert.match(html, /二维码自动取得中继配置|从二维码自动取得/u)

  // 渲染侧：状态文案与卡片渲染函数
  for (const text of ['未配置', '检测中…', '已保存', 'WSS/443 中继已连接']) {
    assert.ok(renderer.includes(text), `renderer missing relay status copy ${text}`)
  }
  assert.match(renderer, /function renderMobileRelayCard/u)
  assert.match(renderer, /function mobileRelayAdapterState/u)
  assert.match(renderer, /\['native-p2p', 'wss-relay'\]\.includes\(adapter\.id\)/u)
  assert.match(renderer, /adapter\.id === 'native-p2p'/u)
})

test('mobile remote status distinguishes negotiating, direct, and relay paths truthfully', async () => {
  const { renderer } = await readRelayFiles()
  assert.match(renderer, /nativeAdapter\?\.path === 'direct'/u)
  assert.match(renderer, /nativeAdapter\?\.path === 'negotiating'/u)
  assert.match(renderer, /nativeAdapter\?\.path === 'relay'/u)
  assert.ok(renderer.includes('原生 P2P 直连已连接'))
  assert.ok(renderer.includes('正在协商原生 P2P'))
  assert.ok(renderer.includes('个人 WSS/443 加密中继已连接（P2P 等待或回退）'))
})

test('relay save/clear calls are centralized behind the expected preload API names', async () => {
  const { renderer } = await readRelayFiles()

  // 所有后端调用集中在一处，方便后端若最终命名不同时统一改名
  assert.match(renderer, /const mobileRelayApi = \{\r?\n  save: url => api\.setMobileSyncRelayUrl\(String\(url \|\| ''\)\.trim\(\)\),\r?\n  clear: \(\) => api\.clearMobileSyncRelayUrl\(\)\r?\n\}/u)
  assert.match(renderer, /function mobileRelayApiAvailable\(\) \{/u)
  assert.match(renderer, /typeof api\.setMobileSyncRelayUrl === 'function' && typeof api\.clearMobileSyncRelayUrl === 'function'/u)

  // 事件处理器只通过 mobileRelayApi 调用，不再直接触碰 api.set/clearMobileSyncRelayUrl
  assert.match(renderer, /mobileRelayApi\.save\(url\)/u)
  assert.match(renderer, /mobileRelayApi\.clear\(\)/u)

  // 名称出现次数固定：声明(2) + 可用性检查(2)，确保没有散落的直连调用
  const setCalls = renderer.match(/setMobileSyncRelayUrl/gu) || []
  const clearCalls = renderer.match(/clearMobileSyncRelayUrl/gu) || []
  assert.equal(setCalls.length, 2, `setMobileSyncRelayUrl should appear exactly 2 times, got ${setCalls.length}`)
  assert.equal(clearCalls.length, 2, `clearMobileSyncRelayUrl should appear exactly 2 times, got ${clearCalls.length}`)

  // 输入归一化：裸域名自动补 wss://，其余按原样交给后端校验
  assert.ok(renderer.includes("const url = /^[a-z][a-z0-9+.-]*:\\/\\//i.test(value) ? value : `wss://${value}`"), 'missing wss:// normalization for bare domains')

  // 兼容契约：保存/清除后必须引导重新生成二维码并让已配对手机重新扫码，
  // 不得写成手机自动迁移（旧手机不会收到桌面热切地址推送）
  const requeueHint = '请重新生成二维码，并在已配对手机重新扫码更新远程线路'
  assert.ok(renderer.includes(`已保存。${requeueHint}`), 'save success must tell user to re-scan in each paired phone')
  assert.ok(renderer.includes(`已清除并恢复默认。${requeueHint}`), 'clear success must tell user to re-scan in each paired phone')
  assert.doesNotMatch(renderer, /自动迁移/u)
  // 初次配置后再配对的新手机自动携带（事实说明，不构成对已配对手机的“自动迁移”承诺）
  assert.ok(renderer.includes('之后新配对的手机扫码会自动携带该配置'), 'fresh pairs after first save should carry the relay automatically')
})

test('relay card has dedicated styles and connection order copy is LAN then native P2P then personal relay', async () => {
  const { html, styles } = await readRelayFiles()

  // 样式覆盖卡片、行布局、输入框与禁用态
  for (const selector of ['.mobile-sync-relay-card', '.mobile-sync-relay-head', '.mobile-sync-relay-row', '.mobile-sync-relay-row input', '.mobile-sync-relay-row button.primary', '.mobile-sync-relay-row button:disabled', '.mobile-sync-relay-message', '.mobile-sync-relay-note']) {
    assert.ok(styles.includes(selector), `styles.css missing ${selector}`)
  }
  assert.match(styles, /@media \(max-width:720px\) \{[\s\S]*?\.mobile-sync-relay-row \{ flex-wrap:wrap; \}[\s\S]*?\.mobile-sync-relay-row input \{ flex-basis:100%; \}[\s\S]*?\}/u)

  // 连接顺序：局域网 → 原生 P2P → 同一 WSS fallback → 旧覆盖网兼容
  assert.match(html, /连接顺序：局域网直连 → 内置原生 P2P（个人 WSS\/443 协调）→ 同一 WSS\/443 端到端加密中继 → 已有 EasyTier \/ Tailscale 兼容线路/u)
  assert.match(html, /智能选择（原生 P2P 优先）/u)
  assert.doesNotMatch(html, /两条远程通道均不可用/u)
  assert.match(html, /所有远程通道均不可用时只暂停远程连接/u)
})

test('backend already exposes relay configuration state via the wss-relay adapter', async () => {
  const { renderer } = await readRelayFiles()

  // 渲染优先读取持久配置，再回退 remote.adapters 的 wss-relay 项
  assert.match(renderer, /const relay = mobileSyncState\.relay \|\| \{\}/u)
  assert.match(renderer, /String\(relay\.relayUrl \|\| adapter\?\.relayUrl \|\| remote\?\.relayUrl \|\| ''\)\.trim\(\)/u)
  assert.match(renderer, /relay\.requiresDeviceUpdate/u)
  assert.match(renderer, /relay\.source === 'invalid'/u)
  assert.match(renderer, /个人中继配置无法读取，请清除恢复默认或重新保存地址/u)
  // 连接状态细分：已连接 / 连接中 / 异常
  assert.match(renderer, /adapter\?\.status === 'connected'/u)
  assert.match(renderer, /adapter\?\.status === 'connecting'/u)
  assert.match(renderer, /adapter\?\.status === 'disconnected' \|\| adapter\?\.error/u)
})