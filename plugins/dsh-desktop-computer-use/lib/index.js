import { defineTool } from '@deepseek-ai/dsh-tools'
import { readFile } from 'node:fs/promises'

const name = 'desktop-computer-use'
const inject = ['tools']

async function execute(action, payload) {
  const file = process.env.HARNESS_DESKTOP_CAPABILITIES_STATE_FILE
  if (!file) throw new Error('桌面能力不可用。')
  const state = JSON.parse(await readFile(file, 'utf8'))
  const origin = new URL(state.origin)
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !state.token) throw new Error('桌面能力端点无效。')
  const response = await fetch(new URL('/action', state.origin), {
    method: 'POST',
    headers: { Authorization: `Bearer ${state.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope: 'computer', action, payload })
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error || 'Computer Use 失败。')
  return body
}

function apply(ctx) {
  ctx.systemPrompt.section({
    name: 'tool:desktop-computer-use',
    order: 116,
    text: 'Computer Use is a built-in desktop skill; never ask the user to install it or add a skill card. Status may report that current-session control is off; only then ask the user to start this control session in the Profile panel. Use targets to discover policy-allowed Windows applications and select to bind one exact window. Persistent default_app_access and per-application allow/deny policy decide whether a target is available. Screenshot reads the selected surface; for external applications, take a new screenshot before every click, type, or scroll because each action invalidates the prior surface. Click, type, and scroll still require the Host-provided per-action confirmation. Never operate Windows security/UAC/elevated surfaces or enter passwords, tokens, verification codes, payment, banking, or other sensitive content. Stop ends the control session and clears the target.'
  })
  ctx.tools.register(defineTool({
    name: 'computer_use',
    description: 'Use the built-in Harness Desktop or a visible Windows application allowed by the persistent Computer Use policy. Discover targets, bind one exact window, then screenshot or request confirmed input. Windows security/elevated surfaces and sensitive input are always forbidden; no Shell or scripts are exposed.',
    timeoutMs: 30000,
    parameters: {
      action: { type: 'string', required: true, enum: ['status', 'targets', 'select', 'screenshot', 'click', 'type', 'scroll', 'stop'] },
      target_id: { type: 'string', description: 'Opaque visible-window target id returned by targets.' },
      x: { type: 'number' },
      y: { type: 'number' },
      text: { type: 'string' },
      delta_y: { type: 'number' },
      confirmation_id: { type: 'string' }
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }]
    },
    execute: args => execute(args.action, {
      target_id: args.target_id,
      x: args.x,
      y: args.y,
      text: args.text,
      delta_y: args.delta_y,
      confirmation_id: args.confirmation_id
    })
  }))
}

export { apply, inject, name }
