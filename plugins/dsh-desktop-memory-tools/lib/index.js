import { readFile } from 'node:fs/promises'
import { defineTool } from '@deepseek-ai/dsh-tools'

const name = 'desktop-memory-tools'
const inject = ['agents', 'systemPrompt', 'tools']

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
  if (!response.ok) throw new Error(body.error || '本地记忆操作失败。')
  return body
}

function currentDirectHumanRoot(ctx, exec) {
  const agent = exec?.agent
  if (!agent || !ctx.agents.roots().some(candidate => candidate.id === agent.id)) return false
  const events = agent.session?.events || []
  let start = -1
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.type === 'turn/end') return false
    if (events[index]?.type === 'turn/start') { start = index; break }
  }
  return start >= 0 && events.slice(start + 1).some(event => event?.type === 'user/message' && event.data?.source?.kind === 'user')
}

function apply(ctx) {
  ctx.systemPrompt.section({
    name: 'tool:desktop-local-memory',
    order: 117,
    text: 'Use local memory quietly when it can materially improve continuity: search for relevant prior preferences or project constraints before relying on assumptions. In a direct-human root turn, remember only stable user preferences, durable instructions, project constraints, or reusable facts that the user intentionally supplied. Never save raw conversation transcripts, temporary requests, inferred sensitive traits, passwords, tokens, cookies, verification codes, payment or banking data. Do not announce routine background memory operations unless the user asks or the recalled fact changes the answer.'
  })
  ctx.tools.register(defineTool({
    name: 'local_memory',
    description: 'Privately use bounded local cross-session memory. status checks availability; search retrieves a small relevant subset; remember stores one concise stable preference or project fact only from a direct-human root turn. It never reads the whole database and cannot delete memory.',
    timeoutMs: 15000,
    parameters: {
      action: { type: 'string', required: true, enum: ['status', 'search', 'remember'], description: 'status, bounded search, or one safe durable memory write.' },
      query: { type: 'string', description: 'search query, at most 200 characters.' },
      max_results: { type: 'number', description: 'search result limit from 1 through 8.' },
      kind: { type: 'string', enum: ['preference', 'instruction', 'project', 'fact'], description: 'remember category.' },
      title: { type: 'string', description: 'short remember title.' },
      content: { type: 'string', description: 'one concise stable fact; never raw conversation or sensitive data.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'optional short local tags.' }
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute(args, exec) {
      if (args.action === 'remember' && !currentDirectHumanRoot(ctx, exec)) throw new Error('自动记忆写入只允许直接用户驱动的根会话。')
      return applyAction(args.action, {
        query: args.query,
        max_results: args.max_results,
        kind: args.kind,
        title: args.title,
        content: args.content,
        tags: args.tags,
        source_session_id: args.action === 'remember' ? exec.agent.id : undefined
      })
    }
  }))
}

export { apply, inject, name }
