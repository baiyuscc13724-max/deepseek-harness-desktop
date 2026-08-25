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

test('官方运行时：per-session 草稿经 createChatStore persist 持久化', async () => {
  const source = await readRuntimeSource('@deepseek-ai/dsh-client-ui-conversation/lib/client.js')

  // 会话级 chat store 使用持久化键 dsh.conversation.chat，并在 init 态提供 draft 字段。
  assert.match(source, /function createChatStore\(\)/, 'createChatStore 缺失')
  assert.match(source, /persist:\s*"dsh\.conversation\.chat"/, 'per-session 草稿缺少持久化键 dsh.conversation.chat')

  // init 态必须含 draft 字段，且 setDraft 为唯一写入口。
  const storeInit = source.slice(source.indexOf('function createChatStore()'))
  assert.match(storeInit, /\bdraft:\s*""/, 'store 初始态缺少 draft 字段')
  assert.match(storeInit, /setDraft:\s*\(d,\s*text\)\s*=>\s*\{\s*d\.draft\s*=\s*text;\s*\}/, 'setDraft action 未把文本写入 draft')
})

test('官方运行时：草稿在会话恢复时回填并双向镜像，避免重启丢失', async () => {
  const source = await readRuntimeSource('@deepseek-ai/dsh-client-ui-conversation/lib/client.js')

  // ConversationSession 在 composer 为空时从持久化 store 回填草稿。
  assert.match(source, /const storedDraft = useStore\(\(s\) => s\.draft\)/, '缺少 storedDraft 读取')
  assert.match(source, /if \(inputState\.draft === "" && storedDraft !== ""\) inputActions\.setDraft\(storedDraft\)/,
    '空 composer 未从持久化 store 恢复草稿')

  // 输入变更经 bindDraftMirror 写回持久化 store，前后一致。
  assert.match(source, /const unmirror = bindDraftMirror\(actions\.setDraft\)/, '缺少 bindDraftMirror 镜像写入')
  assert.match(source, /return \(\) => \{\s*unmirror\(\);\s*\}/, '缺少 bindDraftMirror 清理')
})

test('官方运行时：发送失败保留草稿（仅未被用户改动时恢复），错误经 promptError 提示', async () => {
  const source = await readRuntimeSource('@deepseek-ai/dsh-client-ui-conversation/lib/client.js')

  // 默认 sink 对失败首条提示：banner 走 promptError，草稿仅在未被改动时恢复。
  assert.match(source, /banner via promptError, draft restored only while untouched/,
    '缺少“失败保留草稿”契约注释（promptError → 草稿未被改动才恢复）')

  // send 语义：业务失败进入 promptError；composer 据此恢复草稿。
  assert.match(source, /the composer restores the draft on it/, '缺少“composer 在失败时恢复草稿”的发送语义')

  // promptError 在输入栏作为错误 toast/banner 呈现。
  assert.match(source, /const promptError = useSession\(\(s\) => s\.promptError\) \?\? null/, '输入栏缺少 promptError 读取')
  assert.match(source, /\$\{promptError\.error\.message\} \(\$\{promptError\.error\.code\}\)/, 'promptError 缺少可读错误提示')
})

test('官方运行时：历史分页 loadOlder 保留锚定滚动位置', async () => {
  const source = await readRuntimeSource('@deepseek-ai/dsh-client-ui-conversation/lib/client.js')

  // 会话服务提供加载更早一页的方法。
  assert.match(source, /async loadOlder\(\)/, '缺少 loadOlder 会话方法')

  // ChatView 在分页前记录锚点（key + top）以恢复滚动位置，避免加载后跳动。
  const anchored = source.slice(source.indexOf('const loadOlderAnchored = () =>'))
  assert.match(anchored, /anchorRef\.current = \{\s*key: row\.dataset\.chatAnchorKey,\s*top: flowTop\(row, el\)\s*\}/,
    '缺少 loadOlder 锚定（key + top）')
  assert.match(anchored, /loadOlder\(\)/, '锚定后未调用 loadOlder')
})

test('官方运行时：模型重试具备完整可视状态（scheduled/active/cancelled/started + role=status）', async () => {
  const source = await readRuntimeSource('@deepseek-ai/dsh-client-ui-conversation/lib/client.js')

  // 重试行按状态给出明确文案并暴露给无障碍层。
  assert.match(source, /node\.retryState === "cancelled"/, '缺少 cancelled 重试态')
  assert.match(source, /node\.retryState === "started"/, '缺少 started 重试态')
  assert.match(source, /t\("message\.retry\.scheduled"\)/, '缺少 scheduled 默认态')
  assert.match(source, /role:\s*"status"/, '重试状态未暴露为 role=status')
  assert.match(source, /t\("message\.retry\.status", \{/, '缺少重试进度文案 message.retry.status')
  assert.match(source, /t\("message\.retry\.failure"\)/, '缺少失败原因文案 message.retry.failure')

  // retryState === "scheduled" 被视为“活动/进行中”的入口。
  assert.match(source, /active: data\.current\.retryState === "scheduled"/, '缺少 scheduled→active 映射')
})

test('官方运行时：当前活动会话经 dsh.sessions.current 持久化并在下次启动恢复', async () => {
  const source = await readRuntimeSource('@deepseek-ai/dsh-client-runtime/lib/client.js')

  // 当前会话选择被持久化。
  assert.match(source, /persist:\s*\{\s*name:\s*"dsh\.sessions\.current"\s*\}/, '缺少 dsh.sessions.current 持久化')

  // 启动时读取被持久化的 sessionId（及子代理地址）并恢复管理器。
  assert.match(source, /const restored = this\.selection\.getSnapshot\(\)/, '未读取被持久化的当前会话')
  assert.match(source, /restored\.sessionId, restored\.subagentAddress/, '未用持久化 sessionId/subagentAddress 恢复会话管理器')
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
