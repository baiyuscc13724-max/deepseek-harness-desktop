const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { readFile } = require('node:fs/promises')

// ---------------------------------------------------------------------------
// 只读“源契约”门禁（read-only source-contract gate）
//
// 目的：固化官方运行时已经具备的会话微体验，避免桌面端重复实现。这些能力
// 全部位于官方 node_modules 运行时源码中，桌面绝不修改它们；本测试只在发现
// 上游契约漂移（会破坏桌面对草稿/当前会话/历史/重试的既有预期）时亮红灯。
//
// 约定：只读官方运行时与桌面插件客户端源码文本并断言关键契约 marker。
// 若上游把某个能力移走，门禁会失败，届时应更新“已具备”结论而**不是**在桌面
// 重复实现。
// ---------------------------------------------------------------------------

const root = path.resolve(__dirname, '..')

async function readRuntimeSource(relative) {
  // 这些文件是官方运行时，桌面从不写回；测试仅读取其文本作为契约证据。
  return readFile(path.join(root, 'node_modules', relative), 'utf8')
}

// 桌面自己的会话体验插件客户端：它应复用官方运行时草稿持久化，只写入内存
// composer，而**不**自行引入第二套草稿持久化键。
const DESKTOP_SESSION_CLIENT = path.join(root, 'plugins', 'dsh-session-experience', 'lib', 'client.js')

test('官方 alpha.2 原生模块保留会话微体验合同', async () => {
  const [chat, conversation, sessionController] = await Promise.all([
    readRuntimeSource('@deepseek-ai/dsh-client-ui-chat/lib/client.js'),
    readRuntimeSource('@deepseek-ai/dsh-client-ui-conversation/lib/client.js'),
    readRuntimeSource('@deepseek-ai/dsh-api-session-controller/lib/client.js')
  ])

  const chatStore = chat.slice(chat.indexOf('function createChatStore()'))
  assert.match(chatStore, /return \(0, _deepseek_ai_dsh_client_store\.defineStore\)\(\{\s*init: \(\) => \(\{\s*selection: null,\s*turnProcesses: \[\]/,
    'chat selection state must remain a scope-local store, not the removed draft persistence seam')
  assert.match(chatStore, /setTurnProcessOpen: \(draft, turn, generation, open\) => \{/,
    'chat store must retain the turn-process disclosure action')

  assert.match(conversation, /const promptError = useSession\(\(s\) => s\.promptError\) \?\? null/,
    'composer must select the controller prompt error')
  assert.match(conversation, /showToast\(error\.code === "session\/attachment-invalid"[\s\S]{0,280}: `\$\{error\.message\} \(\$\{error\.code\}\)`\)/,
    'composer must expose an actionable message and code for ordinary prompt failures')

  const anchored = chat.slice(chat.indexOf('const loadOlderAnchored = () =>'))
  assert.match(anchored, /const row = pagingAnchor\(local, el\);[\s\S]{0,260}anchorRef\.current = \{\s*key: row\.dataset\.chatAnchorKey,\s*top: flowTop\(row, el\)\s*\}/,
    'chat paging must capture a stable key/top anchor before prepending history')
  assert.match(anchored, /\}\s*loadOlder\(\);/, 'anchored paging must invoke the session load operation')

  assert.match(chat, /const label = active \? t\("message\.retry\.active"\) : node\.retryState === "cancelled" \? t\("message\.retry\.cancelled"\) : node\.retryState === "started" \? t\("message\.retry\.started"\) : t\("message\.retry\.scheduled"\);/,
    'retry rows must distinguish active, cancelled, started, and scheduled states')
  assert.match(chat, /role: "status",\s*children: t\("message\.retry\.status", \{/,
    'retry progress must remain available to assistive technology')
  assert.match(chat, /children: t\("message\.retry\.failure"\)/, 'retry details must retain the failure label')

  assert.match(sessionController, /this\.selection = \(0, _deepseek_ai_dsh_client_store\.createSnapshotStore\)\(\{\}, \{ persist: \{ name: "dsh\.sessions\.current" \} \}\);/,
    'session controller must persist the active selection under the native key')
  assert.match(sessionController, /const restored = this\.selection\.getSnapshot\(\);\s*this\.manager = new SessionManager\(remote, restored\.sessionId, restored\.subagentAddress\);/,
    'session controller must restore both real-session and subagent selection addresses')
})

test('桌面端不重复实现草稿/当前会话持久化（依赖官方运行时）', async () => {
  // 桌面会话体验插件只把请求放进内存 composer（复用官方字典与 setDraft），
  // 不引入第二套持久化键，避免与官方 dsh.conversation.chat / dsh.sessions.current 冲突。
  const client = await readFile(DESKTOP_SESSION_CLIENT, 'utf8')

  // 桌面应复用运行时 inputActions.setDraft，不声明官方键，也不以浏览器存储
  // 新建 draft / activeSession 语义；这里不禁止插件为其他独立功能使用存储。
  assert.match(client, /inputActions\.setDraft/, '桌面会话插件未复用官方 composer setDraft')
  assert.doesNotMatch(client, /dsh\.conversation\.chat/, '桌面会话插件不应重复声明官方草稿持久化键')
  assert.doesNotMatch(client, /dsh\.sessions\.current/, '桌面会话插件不应重复声明官方当前会话持久化键')
  assert.doesNotMatch(client, /(?:window\.)?localStorage\.(?:getItem|setItem)\([^\n]*(?:draft|activeSession)/i,
    '桌面会话插件不应通过 localStorage 新建草稿或当前会话键')
  assert.doesNotMatch(client, /indexedDB\.open\([^\n]*(?:draft|activeSession)/i,
    '桌面会话插件不应通过 IndexedDB 新建草稿或当前会话存储')
})
