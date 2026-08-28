'use strict'

const { spawn } = require('node:child_process')

const DEFAULT_TIMEOUT_MS = 8_000
const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024

function encodedCommand(script) {
  return Buffer.from(String(script), 'utf16le').toString('base64')
}

function runWindowsPowerShell(script, input, options = {}) {
  if (process.platform !== 'win32') return Promise.reject(Object.assign(new Error('Windows UI Automation 只在 Windows 主机可用。'), { code: 'uia-platform-unsupported' }))
  const timeoutMs = Math.max(1_000, Math.min(20_000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS))
  const maxBytes = Math.max(64 * 1024, Math.min(8 * 1024 * 1024, Number(options.maxBytes) || DEFAULT_MAX_OUTPUT_BYTES))
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedCommand(script)], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, HARNESS_DESKTOP_UIA_INPUT: Buffer.from(JSON.stringify(input || {}), 'utf8').toString('base64') }
    })
    const output = []
    const errors = []
    let bytes = 0
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(value)
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(Object.assign(new Error('Windows UI Automation 操作超时。'), { code: 'uia-timeout' }))
    }, timeoutMs)
    child.stdout.on('data', chunk => {
      bytes += chunk.length
      if (bytes > maxBytes) {
        child.kill()
        finish(Object.assign(new Error('Windows UI Automation 返回内容超过上限。'), { code: 'uia-output-too-large' }))
        return
      }
      output.push(chunk)
    })
    child.stderr.on('data', chunk => {
      if (errors.reduce((sum, item) => sum + item.length, 0) < 64 * 1024) errors.push(chunk)
    })
    child.on('error', error => finish(Object.assign(new Error(`Windows UI Automation 无法启动：${error.message}`), { code: 'uia-unavailable' })))
    child.on('close', code => {
      if (settled) return
      const stdout = Buffer.concat(output).toString('utf8').replace(/^\uFEFF/u, '').trim()
      if (code !== 0) {
        const detail = Buffer.concat(errors).toString('utf8').trim().slice(-2_000)
        finish(Object.assign(new Error(detail || `Windows UI Automation 失败（${code}）。`), { code: 'uia-failed' }))
        return
      }
      try { finish(null, stdout ? JSON.parse(stdout) : null) }
      catch { finish(Object.assign(new Error('Windows UI Automation 返回了无效数据。'), { code: 'uia-invalid-output' })) }
    })
  })
}

const OBSERVE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$input = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:HARNESS_DESKTOP_UIA_INPUT)) | ConvertFrom-Json
$maxNodes = [Math]::Max(1, [Math]::Min(500, [int]$input.maxNodes))
if ([int64]$input.hwnd -gt 0) { $root = [Windows.Automation.AutomationElement]::FromHandle([IntPtr][int64]$input.hwnd) } else { $root = [Windows.Automation.AutomationElement]::RootElement }
if ($null -eq $root) { throw 'UI Automation root unavailable' }
$walker = [Windows.Automation.TreeWalker]::ControlViewWalker
$queue = New-Object System.Collections.Queue
$queue.Enqueue(@($root, -1))
$rows = New-Object System.Collections.ArrayList
while ($queue.Count -gt 0 -and $rows.Count -lt $maxNodes) {
  $item = $queue.Dequeue(); $node = $item[0]; $parent = [int]$item[1]
  try {
    $current = $node.Current
    $rect = $current.BoundingRectangle
    $password = [bool]$current.IsPassword
    $type = [string]$current.ControlType.ProgrammaticName
    $role = $type -replace '^ControlType\.', ''
    $runtime = try { (($node.GetRuntimeId() | ForEach-Object { [string]$_ }) -join '.') } catch { '' }
    $name = if ($password) { '' } else { [string]$current.Name }
    $row = [ordered]@{
      parent = $parent; runtimeId = $runtime; role = $role; name = $name; automationId = [string]$current.AutomationId
      className = [string]$current.ClassName; enabled = [bool]$current.IsEnabled; focused = [bool]$current.HasKeyboardFocus
      isPassword = $password; clickable = @('Button','MenuItem','Hyperlink','ListItem','TabItem','CheckBox','RadioButton','TreeItem') -contains $role
      editable = (-not $password) -and (@('Edit','Document','ComboBox') -contains $role)
      scrollable = @('Pane','List','Tree','DataGrid','DataItem','ScrollBar') -contains $role
      bounds = if ($rect.Width -gt 0 -and $rect.Height -gt 0) { [ordered]@{ x=[int][Math]::Round($rect.X); y=[int][Math]::Round($rect.Y); width=[int][Math]::Round($rect.Width); height=[int][Math]::Round($rect.Height) } } else { $null }
    }
    $index = $rows.Add($row)
    $child = $walker.GetFirstChild($node)
    while ($null -ne $child -and ($queue.Count + $rows.Count) -lt ($maxNodes * 2)) { $queue.Enqueue(@($child, $index)); $child = $walker.GetNextSibling($child) }
  } catch {}
}
@{ rows=$rows; truncated=($queue.Count -gt 0) } | ConvertTo-Json -Depth 7 -Compress
`

const PERFORM_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$input = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:HARNESS_DESKTOP_UIA_INPUT)) | ConvertFrom-Json
if ([int64]$input.hwnd -gt 0) { $root = [Windows.Automation.AutomationElement]::FromHandle([IntPtr][int64]$input.hwnd) } else { $root = [Windows.Automation.AutomationElement]::RootElement }
if ($null -eq $root) { throw 'UI Automation root unavailable' }
$walker = [Windows.Automation.TreeWalker]::ControlViewWalker
$queue = New-Object System.Collections.Queue; $queue.Enqueue($root)
$found = $null; $seen = 0
while ($queue.Count -gt 0 -and $seen -lt 500 -and $null -eq $found) {
  $node = $queue.Dequeue(); $seen++
  try {
    $runtime = (($node.GetRuntimeId() | ForEach-Object { [string]$_ }) -join '.')
    if (($input.runtimeId -and $runtime -eq [string]$input.runtimeId) -or (-not $input.runtimeId -and $node.Current.AutomationId -eq [string]$input.automationId -and $node.Current.Name -eq [string]$input.name)) { $found = $node; break }
    $child = $walker.GetFirstChild($node)
    while ($null -ne $child -and ($queue.Count + $seen) -lt 1000) { $queue.Enqueue($child); $child = $walker.GetNextSibling($child) }
  } catch {}
}
if ($null -eq $found) { @{ handled=$false; reason='stale' } | ConvertTo-Json -Compress; exit 0 }
try { $found.SetFocus() } catch {}
$handled = $false; $via = 'focus'
if ([string]$input.action -eq 'click') {
  $pattern = $null
  if ($found.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) { $pattern.Invoke(); $handled=$true; $via='InvokePattern' }
  elseif ($found.TryGetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) { $pattern.Select(); $handled=$true; $via='SelectionItemPattern' }
  elseif ($found.TryGetCurrentPattern([Windows.Automation.TogglePattern]::Pattern, [ref]$pattern)) { $pattern.Toggle(); $handled=$true; $via='TogglePattern' }
}
@{ handled=$handled; completed=$handled; via=$via } | ConvertTo-Json -Compress
`

function rowsToTree(rows, target) {
  if (!Array.isArray(rows) || !rows.length) return null
  const nodes = rows.map(row => ({
    role: String(row.role || 'control').toLowerCase(),
    name: row.isPassword ? '' : String(row.name || ''),
    automationId: String(row.automationId || ''),
    runtimeId: String(row.runtimeId || ''),
    className: String(row.className || ''),
    bounds: row.bounds || null,
    enabled: row.enabled !== false,
    focused: row.focused === true,
    sensitive: row.isPassword === true,
    clickable: row.clickable === true,
    editable: row.editable === true,
    scrollable: row.scrollable === true,
    targetId: target.id,
    executable: target.window?.exeName || target.window?.executable || '',
    children: []
  }))
  for (let index = 0; index < nodes.length; index += 1) {
    const parent = Number(rows[index]?.parent)
    if (Number.isInteger(parent) && parent >= 0 && parent < nodes.length && parent !== index) nodes[parent].children.push(nodes[index])
  }
  return nodes[0]
}

class WindowsUiAutomationSource {
  constructor(options = {}) {
    this.run = typeof options.run === 'function' ? options.run : runWindowsPowerShell
    this.available = typeof options.available === 'boolean' ? options.available : process.platform === 'win32'
  }

  async observe(target, options = {}) {
    if (!this.available) return null
    const result = await this.run(OBSERVE_SCRIPT, { hwnd: target.kind === 'window' ? target.hwnd : 0, maxNodes: Math.max(1, Math.min(500, Number(options.maxNodes) || 500)) })
    return rowsToTree(result?.rows, target)
  }

  async perform(action, raw) {
    if (!this.available || raw?.sensitive === true) return { handled: false, sensitive: raw?.sensitive === true }
    return this.run(PERFORM_SCRIPT, {
      action,
      hwnd: String(raw?.targetId || '').startsWith('window:') ? Number(String(raw.targetId).slice(7)) : 0,
      runtimeId: String(raw?.runtimeId || ''),
      automationId: String(raw?.automationId || ''),
      name: String(raw?.name || '')
    })
  }
}

module.exports = {
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS,
  OBSERVE_SCRIPT,
  PERFORM_SCRIPT,
  WindowsUiAutomationSource,
  encodedCommand,
  rowsToTree,
  runWindowsPowerShell
}
