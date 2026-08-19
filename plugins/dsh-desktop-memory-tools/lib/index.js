import { readFile } from 'node:fs/promises'
import { defineTool } from '@deepseek-ai/dsh-tools'

const name = 'desktop-memory-tools'
const inject = ['tools']

async function state() {
  const file = String(process.env.HARNESS_DESKTOP_CAPABILITIES_STATE_FILE || '').trim()
  if (!file) throw new Error('Harness Desktop 未提供本地能力状态文件。')
  const value = JSON.parse(await readFile(file, 'utf8'))
  const target = new URL(value.origin)
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || !value.token) throw new Error('本地能力端点无效。')
  return value
}

async function applyAction(action, payload = {}) {
  const local = await state()
  const response = await fetch(new URL('/action', local.origin), {
    method: 'POST',
    headers: { Authorization: `Bearer ${local.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope: 'memory', action, payload })
  })
  const body = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }))
  if (!response.ok) throw new Error(body.error || '本地记忆查询失败。')
  return body
}

function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'local_memory',
    description: '查询用户明确开启的本地跨会话记忆。只支持状态和有限搜索；不会读取整库，也不能保存、修改或删除记忆。用户未开启“允许模型按需召回”时搜索必定拒绝。',
    timeoutMs: 15000,
    parameters: {
      action: { type: 'string', required: true, enum: ['status', 'search'], description: 'status 查询可用状态；search 按关键词有限召回。' },
      query: { type: 'string', description: 'search 的自然语言关键词，最长 200 字符。' },
      max_results: { type: 'number', description: '最多返回条数，范围 1-8。' }
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute(args) {
      return applyAction(args.action, { query: args.query, max_results: args.max_results })
    }
  }))
}

export { apply, inject, name }
