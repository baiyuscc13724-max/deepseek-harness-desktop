import { defineTool } from '@deepseek-ai/dsh-tools'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

async function executeDesktop(action, payload, { signal } = {}) {
  const file = process.env.HARNESS_DESKTOP_CAPABILITIES_STATE_FILE
  if (!file) throw new Error('桌面能力不可用。')
  const state = JSON.parse(await readFile(file, 'utf8'))
  const origin = new URL(state.origin)
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !state.token) throw new Error('桌面能力端点无效。')
  const response = await fetch(new URL('/action', state.origin), {
    method: 'POST',
    headers: { Authorization: `Bearer ${state.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope: 'desktop', action, payload, request_id: randomUUID() }),
    signal
  })
  const body = await response.json()
  if (!response.ok) throw Object.assign(new Error(body.error || '桌面结构化控制失败。'), {
    code: body.code || 'desktop-control-error', statusCode: response.status,
    retryable: false,
    ...(body.code === 'browser-request-scope-invalid' ? { guidance: 'Host 控制服务与已安装 desktop_control 插件协议不一致；检查配套版本，不要改成 computer scope 或放宽授权。' } : {})
  })
  return body
}

function registerDesktopControl(ctx) {
  ctx.tools.register(defineTool({
    name: 'desktop_control',
    description: 'AI-first structured control for the Windows desktop. Prefer observe plus opaque ref actions for non-web desktop software; use screenshot coordinates only when the structured tree has no usable control. Web pages must use browser_control whenever its CDP/DOM channel is available. Reuses the same Computer Use authorization and Stop session; exposes no shell or scripts.',
    timeoutMs: 30000,
    parameters: {
      action: { type: 'string', required: true, enum: ['status', 'targets', 'selectTarget', 'observe', 'inspect', 'click', 'type', 'scroll', 'screenshot', 'requestAuthorization', 'stop'] },
      ref: { type: 'string', description: 'Opaque ref returned by the latest observe; refs expire on the next observation or target change.' },
      target_id: { type: 'string', description: 'Target id returned by targets. Select a window or the complete desktop explicitly.' },
      x: { type: 'number', description: 'Visual fallback only: x pixel in the latest desktop_control screenshot.' },
      y: { type: 'number', description: 'Visual fallback only: y pixel in the latest desktop_control screenshot.' },
      text: { type: 'string' },
      delta_y: { type: 'number' }
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }]
    },
    execute: (args, exec) => executeDesktop(args.action, {
      ref: args.ref,
      target_id: args.target_id,
      x: args.x,
      y: args.y,
      text: args.text,
      delta_y: args.delta_y
    }, { signal: exec?.signal })
  }))
}

export { executeDesktop, registerDesktopControl }
