import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { defineTool } from '@deepseek-ai/dsh-tools'

const name = 'mobile-control'
const inject = ['tools']

function desktopControlStateFile() {
  const configured = String(process.env.HARNESS_MOBILE_SYNC_STATE_FILE || '').trim()
  if (!configured) throw new Error('Harness Desktop 未提供手机控制状态文件。')
  return path.join(path.dirname(configured), 'mobile-sync.desktop-control.json')
}

async function desktopControlConfig() {
  const state = await readFile(desktopControlStateFile(), 'utf8').then(JSON.parse).catch(() => null)
  if (!state || state.version !== 1) throw new Error('手机同步服务未运行或桌面控制凭据已失效。')
  const port = Number(state.port)
  const bearer = String(state.bearer || '')
  const generation = String(state.generation || '')
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^[A-Za-z0-9_-]{32,}$/.test(bearer) || !/^[a-f0-9]{32}$/.test(generation)) {
    throw new Error('手机同步服务的桌面控制状态无效。')
  }
  return {
    origin: `http://127.0.0.1:${port}/__harness_mobile__/control`,
    headers: {
      Authorization: `Bearer ${bearer}`,
      'X-Harness-Mobile-Control': '1',
      'X-Harness-Mobile-Control-Generation': generation
    }
  }
}

async function request(requestPath, init = {}) {
  const config = await desktopControlConfig()
  const response = await fetch(`${config.origin}${requestPath}`, {
    ...init,
    headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}), ...config.headers }
  })
  const text = await response.text()
  let payload
  try { payload = JSON.parse(text) } catch { payload = { ok: false, error: text || `HTTP ${response.status}` } }
  if (!response.ok) throw new Error(payload.error || payload.message || `手机控制请求失败（HTTP ${response.status}）。`)
  return payload
}

function chooseDevice(state, requested) {
  const devices = Array.isArray(state?.control?.devices) ? state.control.devices : []
  if (requested) {
    const selected = devices.find(device => device.id === requested)
    if (!selected) throw new Error('没有找到指定的已配对手机。')
    return selected
  }
  const ready = devices.filter(device => device.ready)
  if (ready.length === 1) return ready[0]
  if (!ready.length) throw new Error('没有已开启并准备好的手机控制设备。请让用户在手机设置中完成授权。')
  throw new Error('有多台手机控制设备已就绪，请先用 status 查看并指定 device_id。')
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason || new Error('已取消'))
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason || new Error('已取消'))
    }, { once: true })
  })
}

function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'android_control',
    description: '在用户已于手机端明确开启“手机控制”后，观察或操作已配对 Android 手机。只支持固定动作，不执行 Shell/脚本；密码、支付、银行、验证码、清除数据、静默安装卸载和权限绕过始终禁止。textInput、文件写入和清理缓存会在手机端二次确认。先调用 status 确认设备与 capability；每个动作都会等待明确回执。',
    timeoutMs: 75_000,
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['status', 'stop', 'observe', 'tap', 'longPress', 'swipe', 'back', 'home', 'recents', 'textInput', 'openApp', 'openUri', 'openSettings', 'screenshot', 'fileOpen', 'fileCreate', 'clearCache'],
        description: '固定操作名。status 查询状态，stop 立即停止。'
      },
      device_id: { type: 'string', description: '多台设备时指定状态中显示的设备 ID。' },
      payload: {
        type: 'object',
        additionalProperties: true,
        description: '动作参数：tap/longPress 用 x,y；swipe 用 startX,startY,endX,endY；textInput 用 text；openApp/clearCache 用 packageName；openUri 用 uri；screenshot 可用 maxWidth/quality。'
      },
      timeout_ms: { type: 'number', description: '单次动作超时，1000-60000 毫秒。' },
      retry_limit: { type: 'number', description: '失败重试上限，0-2。' }
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }]
    },
    async execute(args, exec) {
      const state = await request('/desktop-state')
      if (args.action === 'status') return state
      if (args.action === 'stop') {
        const device = args.device_id ? chooseDevice(state, args.device_id) : null
        return request('/desktop-stop', { method: 'POST', body: JSON.stringify({ deviceId: device?.id || null }) })
      }
      const device = chooseDevice(state, args.device_id)
      const submitted = await request('/desktop-command', {
        method: 'POST',
        body: JSON.stringify({
          deviceId: device.id,
          command: {
            action: args.action,
            payload: args.payload || {},
            ...(args.timeout_ms !== undefined ? { timeoutMs: args.timeout_ms } : {}),
            ...(args.retry_limit !== undefined ? { retryLimit: args.retry_limit } : {})
          }
        })
      })
      const command = submitted.command
      const deadline = Date.now() + Math.min(70_000, Number(command.timeoutMs || 15_000) * (Number(command.retryLimit || 0) + 1) + 8_000)
      while (Date.now() < deadline) {
        if (exec.signal?.aborted) {
          await request('/desktop-cancel', { method: 'POST', body: JSON.stringify({ commandId: command.id }) }).catch(() => {})
          throw exec.signal.reason || new Error('手机控制已取消。')
        }
        const result = await request(`/desktop-result?id=${encodeURIComponent(command.id)}`)
        if (!result.pending && result.result) return { ok: result.result.ok, deviceId: device.id, command: { id: command.id, action: command.action }, result: result.result }
        try {
          await delay(350, exec.signal)
        } catch (error) {
          await request('/desktop-cancel', { method: 'POST', body: JSON.stringify({ commandId: command.id }) }).catch(() => {})
          throw error
        }
      }
      await request('/desktop-cancel', { method: 'POST', body: JSON.stringify({ commandId: command.id }) }).catch(() => {})
      throw new Error('手机未在超时前返回操作回执，已发送取消指令。')
    }
  }))
}

export { apply, inject, name }
