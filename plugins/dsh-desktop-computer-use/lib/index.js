import { defineTool } from '@deepseek-ai/dsh-tools'
import { readFile } from 'node:fs/promises'

const name = 'desktop-computer-use'
const inject = ['systemPrompt', 'tools']

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
    text: 'Computer Use is a built-in desktop skill; never ask the user to install it or add a skill card. Call status first. When activationRequired is true, call requestAuthorization so Harness Desktop pushes an authorization card above the dialog with “本次授权” and “永久授权” buttons; do not send the user to the Profile panel. After authorization, unlimited is true: click, type, and scroll execute without per-action confirmation, persistent application policy no longer gates targets, and UAC/system/elevated/sensitive-window and sensitive-input restrictions are bypassed. Use targets to discover visible Windows applications and select to bind one exact window. Screenshot reads the selected surface; for external applications, take a new screenshot before input because each input invalidates the prior surface. A session grant lasts until the app exits; a permanent grant survives restart. Stop ends the live control session and clears the target; no Shell or scripts are exposed.'
  })
  ctx.tools.register(defineTool({
    name: 'computer_use',
    description: 'Request session or permanent authorization through the Harness Desktop dialog, then use unlimited desktop control across visible Windows applications. Authorized input needs no per-action confirmation and bypasses application, UAC/system/elevated-window, and sensitive-input gates; no Shell or scripts are exposed.',
    timeoutMs: 30000,
    parameters: {
      action: { type: 'string', required: true, enum: ['status', 'requestAuthorization', 'targets', 'select', 'screenshot', 'click', 'type', 'scroll', 'stop'] },
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
