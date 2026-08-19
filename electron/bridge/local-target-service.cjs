const path = require('node:path')
const { fileURLToPath } = require('node:url')

const BLOCKED_OPEN_EXTENSIONS = new Set([
  '.appref-ms', '.bat', '.cmd', '.com', '.cpl', '.exe', '.hta', '.inf', '.ins',
  '.isp', '.js', '.jse', '.lnk', '.msc', '.msi', '.msp', '.mst', '.pif', '.ps1',
  '.reg', '.scr', '.sct', '.url', '.vb', '.vbe', '.vbs', '.ws', '.wsc', '.wsf', '.wsh',
  '.app', '.command', '.dmg', '.pkg', '.workflow'
])

function unwrapLocalUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) throw new Error('本机路径为空。')
  if (!/^harness-desktop:\/\/open-local(?:[/?#]|$)/i.test(raw)) return raw
  const target = new URL(raw)
  const localPath = target.searchParams.get('path')
  if (!localPath) throw new Error('本机路径为空。')
  return localPath
}

function trimAuthoredDecoration(value) {
  let result = String(value || '').trim()
  const pairs = [['`', '`'], ['"', '"'], ["'", "'"], ['<', '>'], ['（', '）'], ['(', ')']]
  for (const [left, right] of pairs) {
    if (result.startsWith(left) && result.endsWith(right) && result.length > left.length + right.length) {
      result = result.slice(left.length, -right.length).trim()
      break
    }
  }
  return result
}

function decodeMarkdownPath(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function splitLocationSuffix(value) {
  const fragment = value.match(/^(.*?)(?:#L(\d+)(?:C(\d+))?|:(\d+)(?::(\d+))?)$/i)
  if (!fragment) return { value, line: null, column: null }
  const candidate = fragment[1]
  if (!candidate || /^[a-z]$/i.test(candidate)) return { value, line: null, column: null }
  return {
    value: candidate,
    line: Number(fragment[2] || fragment[4] || 0) || null,
    column: Number(fragment[3] || fragment[5] || 0) || null
  }
}

function normalizeLocalTarget(value) {
  let authored = trimAuthoredDecoration(unwrapLocalUrl(value))
  if (/^file:/i.test(authored)) {
    authored = fileURLToPath(new URL(authored))
  } else {
    authored = decodeMarkdownPath(authored)
  }

  const location = splitLocationSuffix(authored)
  const candidate = location.value
  const windowsAbsolute = /^[a-z]:[\\/]/i.test(candidate) || /^\\\\[^\\]+\\[^\\]+/.test(candidate)
  const posixAbsolute = candidate.startsWith('/')
  if (!windowsAbsolute && !posixAbsolute) throw new Error('只允许打开绝对的本机文件或目录路径。')

  const resolved = windowsAbsolute ? path.win32.normalize(candidate) : path.normalize(candidate)
  return { path: resolved, line: location.line, column: location.column }
}

function blocksDirectOpen(file) {
  return BLOCKED_OPEN_EXTENSIONS.has(path.extname(file).toLowerCase())
}

async function openLocalTarget(value, {
  reveal = false,
  statImpl,
  openPath,
  showItemInFolder
} = {}) {
  if (typeof statImpl !== 'function' || typeof openPath !== 'function' || typeof showItemInFolder !== 'function') {
    throw new Error('本机路径打开器不可用。')
  }
  const target = normalizeLocalTarget(value)
  const info = await statImpl(target.path).catch(error => {
    if (error?.code === 'ENOENT') throw new Error(`路径不存在：${target.path}`)
    throw error
  })

  if (reveal && !info.isDirectory()) {
    showItemInFolder(target.path)
    return { ok: true, action: 'reveal', ...target }
  }

  if (blocksDirectOpen(target.path)) {
    showItemInFolder(target.path)
    return { ok: true, action: 'reveal-blocked-executable', ...target }
  }

  const error = String(await openPath(target.path) || '').trim()
  if (!error) return { ok: true, action: info.isDirectory() ? 'open-directory' : 'open-file', ...target }
  showItemInFolder(target.path)
  return { ok: false, action: 'reveal-fallback', error, ...target }
}

module.exports = {
  BLOCKED_OPEN_EXTENSIONS,
  blocksDirectOpen,
  normalizeLocalTarget,
  openLocalTarget
}
