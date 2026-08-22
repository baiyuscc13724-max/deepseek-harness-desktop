import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
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

function currentRoot(ctx, exec) {
  const agent = exec?.agent
  return Boolean(agent && ctx.agents.roots().some(candidate => candidate.id === agent.id))
}

function currentDirectHumanRoot(ctx, exec) {
  if (!currentRoot(ctx, exec)) return false
  const events = exec.agent.session?.events || []
  let start = -1
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.type === 'turn/end') return false
    if (events[index]?.type === 'turn/start') { start = index; break }
  }
  return start >= 0 && events.slice(start + 1).some(event => event?.type === 'user/message' && event.data?.source?.kind === 'user')
}

function rootScopes(exec) {
  const scopes = [{ type: 'personal', ref: null }]
  const cwd = exec?.agent?.session?.header?.cwd
  if (typeof cwd === 'string' && isAbsolute(cwd)) scopes.push({ type: 'project', ref: resolve(cwd) })
  return scopes
}

function apply(ctx) {
  ctx.systemPrompt.section({
    name: 'tool:desktop-local-memory',
    order: 117,
    text: 'Use bounded local memory only from the root agent. Search the personal and current-project scopes when continuity materially helps. In a direct-human root turn, remember one explicitly requested durable fact as active, or suggest one reviewable candidate at a natural goal/task boundary; never save raw transcripts, temporary requests, inferred sensitive traits, credentials, verification codes, payment or banking data. Workers and team members must never search the private memory database: the root may create a task-bound, 30-minute, at-most-five-item/1200-character memory pack and deliver it with team_memory_pack. Packs are ephemeral, their content must not enter durable team state, and workers must not persist them.'
  })
  ctx.tools.register(defineTool({
    name: 'local_memory',
    description: 'Privately use scoped local cross-session memory. status checks availability; search is root-only and bounded; remember stores one explicit active fact; suggest stores one reviewable candidate; pack creates an ephemeral task-bound team handoff. It never reads the whole database and cannot delete memory.',
    timeoutMs: 15000,
    parameters: {
      action: { type: 'string', required: true, enum: ['status', 'search', 'remember', 'suggest', 'pack'], description: 'status, scoped search, explicit write, candidate suggestion, or ephemeral team pack.' },
      query: { type: 'string', description: 'search query, at most 200 characters.' },
      max_results: { type: 'number', description: 'search limit: at most 8 normally and at most 5 for a pack.' },
      kind: { type: 'string', enum: ['preference', 'instruction', 'project', 'fact'], description: 'memory category.' },
      scope: { type: 'string', enum: ['personal', 'project'], description: 'write scope; project requires a current absolute workspace.' },
      title: { type: 'string', description: 'short memory title.' },
      content: { type: 'string', description: 'one concise stable fact; never raw conversation or sensitive data.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'optional short local tags.' },
      source_type: { type: 'string', enum: ['manual', 'session', 'goal', 'task', 'file'], description: 'provenance type for a write.' },
      source_ref: { type: 'string', description: 'bounded non-secret provenance reference.' },
      team_id: { type: 'string', description: 'required team id for pack.' },
      task_id: { type: 'string', description: 'required task id for pack.' }
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute(args, exec) {
      if ((args.action === 'search' || args.action === 'pack') && !currentRoot(ctx, exec)) throw new Error('本地记忆召回只允许根会话；团队成员必须使用负责人下发的临时 Memory Pack。')
      if ((args.action === 'remember' || args.action === 'suggest') && !currentDirectHumanRoot(ctx, exec)) throw new Error('本地记忆写入只允许直接用户驱动的根会话。')
      const scopes = rootScopes(exec)
      const desiredScope = args.scope || (args.kind === 'project' ? 'project' : 'personal')
      const writeScope = scopes.find(scope => scope.type === desiredScope) || scopes[0]
      return applyAction(args.action, {
        query: args.query,
        max_results: args.max_results,
        kind: args.kind,
        title: args.title,
        content: args.content,
        tags: args.tags,
        source_type: args.source_type,
        source_ref: args.source_ref,
        source_session_id: args.action === 'remember' || args.action === 'suggest' ? exec.agent.id : undefined,
        scope_type: writeScope.type,
        scope_ref: writeScope.ref,
        scopes,
        team_id: args.team_id,
        task_id: args.task_id
      })
    }
  }))
}

export { apply, currentDirectHumanRoot, currentRoot, inject, name, rootScopes }
