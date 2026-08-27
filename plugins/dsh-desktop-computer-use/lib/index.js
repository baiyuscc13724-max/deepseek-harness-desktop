import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { readFile } from 'node:fs/promises'

const name = 'desktop-computer-use'
const inject = ['systemPrompt', 'tools']
const computerUseSettingsNamespace = settingsNamespace(name)
// Presence-only namespace: authorization, policy, and session state remain owned by the trusted Electron Host.
const computerUseSettingsSchema = z.object({})

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
  installSettingsSection(ctx, computerUseSettingsNamespace, computerUseSettingsSchema, {}, {
    setSource: () => {},
    onChange: () => {}
  })
  ctx.systemPrompt.section({
    name: 'tool:desktop-computer-use',
    order: 116,
    text: 'Computer Use is a last-resort visual fallback, not the default way to operate software. Before calling it, use the narrowest available structured data-plane tool or API: read/edit/pwsh for files and repositories, browser_control status followed by observe/extract and ref-based actions for web pages, android_control for a paired Android phone, and product-specific tools for their own domains. Do not call computer_use status, targets, or screenshot merely because an application is visible. Use Computer Use only when the user explicitly invokes @computer-use, no structured tool exists, a structured tool has explicitly reported unavailable or unsupported, or the task genuinely depends on desktop visual layout. For browser work, browser_control is mandatory whenever its structured CDP/DOM channel is available; use browser_control screenshot only when visual layout is actually necessary, and never substitute Computer Use screenshot coordinates. Computer Use is a built-in desktop skill bundled with Harness Desktop; its user controls live in Settings > Plugins > Plugin configuration. Call status first after the fallback criteria are met, never ask the user to install it or add a skill card, and never use the browser Profile panel for Computer Use. When activationRequired is true, call requestAuthorization so Harness Desktop pushes an authorization card above the dialog with “本次授权” and “永久授权” buttons; only that trusted Host card may grant access. The plugin card may request that card or stop/revoke access, but cannot grant itself authorization. The same grant and enabled state are shared with background-capable browser_control, so the user authorizes only once. browser_control can run its internal browser in the background through structured CDP/DOM references. After authorization, unlimited is true for desktop Computer Use: click, type, and scroll execute without per-action confirmation, persistent application policy no longer gates targets, and UAC/system/elevated/sensitive-window and sensitive-input restrictions are bypassed; browser_control keeps its own credential, payment, and transaction safety boundaries. The Harness Desktop target remains capturable and controllable while its main window is hidden or minimized. Use targets to discover other Windows applications and select to bind one exact window. Screenshot reads the selected surface and returns its authoritative width/height coordinate space; pass click/type/scroll x/y directly in those screenshot pixels and never rescale to sourceWidth/sourceHeight, monitor resolution, or attachment preview dimensions because the Host maps them automatically; for external applications, take a new screenshot before input because each input invalidates the prior surface. A session grant lasts until the app exits; a permanent grant survives restart but never starts control merely because the app launched—the next explicit Computer Use action resumes it without another authorization prompt. Stop ends the shared live control session and clears the target; no Shell or scripts are exposed.'
  })
  ctx.tools.register(defineTool({
    name: 'computer_use',
    description: 'Last-resort visual desktop fallback. Before calling, use a dedicated structured tool or API whenever one exists; for web pages browser_control status plus CDP/DOM observe/extract/ref actions is mandatory while available, and its screenshot is the visual-layout fallback. Call computer_use only after the user explicitly invokes @computer-use, no structured tool exists, a structured tool explicitly reports unavailable/unsupported, or desktop visual layout is genuinely required. Then request shared authorization if needed and use the selected Harness Desktop or external application window. For click, type, and scroll, x/y are pixels in the latest computer_use screenshot width/height; never pre-scale them to source, monitor, or attachment-preview dimensions because the Host maps them automatically. No Shell or scripts are exposed.',
    timeoutMs: 30000,
    parameters: {
      action: { type: 'string', required: true, enum: ['status', 'requestAuthorization', 'targets', 'select', 'screenshot', 'click', 'type', 'scroll', 'stop'] },
      target_id: { type: 'string', description: 'Opaque visible-window target id returned by targets.' },
      x: { type: 'number', description: 'Horizontal pixel in the latest computer_use screenshot: inputBounds.xMin <= x < inputBounds.xMaxExclusive. Use screenshot pixels exactly; never pre-scale to source/monitor/preview dimensions.' },
      y: { type: 'number', description: 'Vertical pixel in the latest computer_use screenshot: inputBounds.yMin <= y < inputBounds.yMaxExclusive. Use screenshot pixels exactly; never pre-scale to source/monitor/preview dimensions.' },
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

export { apply, computerUseSettingsNamespace, inject, name }
