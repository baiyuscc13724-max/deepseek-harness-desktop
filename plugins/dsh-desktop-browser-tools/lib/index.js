import { readFile } from 'node:fs/promises'
import { defineTool } from '@deepseek-ai/dsh-tools'

const name = 'desktop-browser-tools'
const inject = ['tools']

const ACTIONS = ['status', 'observe', 'navigate', 'click', 'type', 'stop']

const SENSITIVE_HINT =
  '永远禁止输入任一密码、支付、银行、账户、验证码等敏感内容；登录、支付、取款、转账类操作本工具不含，应由用户在桌面浏览器中亲自完成。'

async function loadState() {
  const stateFile = String(process.env.HARNESS_DESKTOP_BROWSER_STATE_FILE || '').trim()
  if (!stateFile) throw new Error('Harness Desktop 未提供桌面浏览器状态文件。')
  let state = {}
  try {
    state = JSON.parse(await readFile(stateFile, 'utf8'))
  } catch {
    state = {}
  }
  const origin = typeof state.origin === 'string' ? state.origin.trim() : ''
  const token = typeof state.token === 'string' ? state.token : ''
  if (!origin || !token) throw new Error('桌面浏览器状态文件缺少 origin 或凭据。')
  if (!isLoopbackOrigin(origin)) throw new Error('桌面浏览器只接受本机回环地址。')
  return { origin, token }
}

function isLoopbackOrigin(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  const host = url.hostname.replace(/^\[|\]$/g, '')
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || /^127\./.test(host)
}

async function request(state, action, payload = {}) {
  const response = await fetch(new URL('/action', state.origin).href, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${state.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ action, payload })
  })
  const text = await response.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = { ok: false, error: text || `HTTP ${response.status}` }
  }
  if (!response.ok) {
    throw new Error(body.error || body.message || `桌面浏览器操作失败（HTTP ${response.status}）。`)
  }
  return body
}

function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'browser_control',
    description: `在用户已于桌面端明确开启“浏览器控制”后，观察或操作已授权的桌面浏览器。只支持固定动作，不执行脚本；每个动作都会等待明确回执，同步返回。${SENSITIVE_HINT}先调用 status 确认可用。`,
    timeoutMs: 60_000,
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ACTIONS,
        description: '固定操作名。status 查询状态，stop 立即停止。'
      },
      url: { type: 'string', description: 'navigate 的目标地址。' },
      ref: { type: 'string', description: 'observe/click/type 定位页面元素的引用标识。' },
      text: {
        type: 'string',
        description: `type 要输入的文本。${SENSITIVE_HINT}`
      },
      confirmation_id: { type: 'string', description: '针对需要确认的操作回传的确认编号。' }
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }]
    },
    async execute(args) {
      const state = await loadState()
      const payload = {}
      for (const key of ['url', 'ref', 'text', 'confirmation_id']) {
        if (args[key] !== undefined) payload[key] = args[key]
      }
      return request(state, args.action, payload)
    }
  }))
}

export { apply, inject, name }
