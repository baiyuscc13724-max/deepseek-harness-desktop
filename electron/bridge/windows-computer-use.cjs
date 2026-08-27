// Windows 跨应用 Computer Use 原生领域层（windows-computer-use）。
//
// 职责（与 computer-use-app-policy.cjs 分层）：
//   - 枚举用户可见的顶层窗口（排除工具窗口/隐藏选项卡），解析精确的应用身份
//     （进程 EXE 路径、AUMID、发布者/产品/程序名、文件 SHA-256、签名验证、
//     完整性级别/提权状态）；
//   - 截图与输入适配接口（PrintWindow 抓取 + SendInput 注入）；
//   - 系统/UAC/提权/敏感窗口的「不可绕过」永久拒绝（classifySystemDeny）；
//   - 组合策略决策：系统禁令优先，其余交给 ComputerUseAppPolicy
//     （default_app_access + AUMID/EXE allow/deny，身份变更失效）；
//   - 能力诚实上报：koffi 未就绪或某个原生动作无法安全执行时返回
//     capability-unavailable；绝不伪造结果。签名验证（WinVerifyTrust）真实
//     执行；证书 SHA-1 指纹在 koffi 3.1.6 的指针语义下无法安全读取，如实
//     上报 thumbprint 不可用，身份绑定走文件哈希路径。
//
// 边界（与主进程既有安全约定保持一致）：
//   - 本层不做「允许一次」或逐动作确认——click/type/scroll 的逐次人工确认
//     是 Harness 不可覆盖的安全约定，由上层确认门禁负责；本层只裁决
//     「该应用是否已被持久允许/拒绝」；
//   - 授权后的全桌面路径直接使用 Windows 虚拟桌面截图和全局 SendInput，
//     不选择单个窗口，也不按输入文本内容设置敏感操作过滤；旧窗口方法仅供
//     兼容内部调用，仍可复用应用策略；
//   - 不添加任何网络服务；测试只使用注入的假适配器，绝不运行或控制用户应用。
//
// 纯领域函数可独立用 node:test 测试；koffi 适配器按能力逐个 try/catch，
// 单个绑定失败只降级对应能力。

const path = require('node:path')
const { createHash } = require('node:crypto')
const { stat, readFile } = require('node:fs/promises')
const { ComputerUseAppPolicy, identityFingerprintFor } = require('./computer-use-app-policy.cjs')

// ---------------------------------------------------------------------------
// 常量与纯函数
// ---------------------------------------------------------------------------

// 系统/OS 关键进程：任何情况下都不允许控制。
// consent.exe: UAC 同意对话框（安全桌面）；logonui.exe: 登录/锁屏；
// fontdrvhost.exe: 安全文本输入/凭据 UI 宿主；其余为系统服务与桌面合成。
const SYSTEM_PROCESS_NAMES = Object.freeze([
  'consent.exe',
  'logonui.exe',
  'winlogon.exe',
  'lsass.exe',
  'csrss.exe',
  'services.exe',
  'smss.exe',
  'wininit.exe',
  'userinit.exe',
  'dwm.exe',
  'fontdrvhost.exe'
])

const SYSTEM_PROCESS_SET = new Set(SYSTEM_PROCESS_NAMES)

// 已知的 Windows 安全对话框窗口类（作为补充启发，主依据始终是进程/完整性）。
const UAC_DIALOG_CLASS = '#32770'
const CREDENTIAL_DIALOG_CLASSES = new Set(['Credential Dialog Xaml Host'])
const UAC_TITLE_RE = /user account control|windows 安全|windows security|^uac$/i
const SENSITIVE_WINDOW_TITLE_RE = /password|passcode|verification code|one[- ]time|\botp\b|密码|验证码|payment|checkout|credit card|card details|banking|\bbank\b|支付|付款|收银台|银行卡|网上银行/i

/**
 * 系统级不可绕过禁令分类（返回 null 表示无系统禁令）。
 * @param {{exeName?:string, integrity?:string, elevated?:boolean}} identity
 * @param {{className?:string, title?:string}} [window]
 * @returns {{nonBypassable:true, reason:string, code:string, detail?:string}|null}
 */
function classifySystemDeny(identity, window = {}) {
  if (!identity || typeof identity !== 'object') {
    return { nonBypassable: true, reason: 'identity-unresolved', code: 'identity-unresolved' }
  }
  const exeName = String(identity.exeName || '').toLowerCase()
  if (SYSTEM_PROCESS_SET.has(exeName)) {
    const code = exeName === 'consent.exe'
      ? 'uac-consent'
      : exeName === 'logonui.exe'
        ? 'logon-ui'
        : exeName === 'fontdrvhost.exe'
          ? 'sensitive-input-host'
          : 'system-process'
    return { nonBypassable: true, reason: 'system', code, detail: exeName }
  }
  const integrity = String(identity.integrity || '').toLowerCase()
  if (integrity === 'system') return { nonBypassable: true, reason: 'system', code: 'integrity-system', detail: integrity }
  if (integrity === 'high' || identity.elevated === true) {
    return { nonBypassable: true, reason: 'system', code: 'elevated', detail: exeName || integrity }
  }
  if (window && typeof window === 'object') {
    const className = String(window.className || '')
    const title = String(window.title || '')
    if (className === UAC_DIALOG_CLASS && UAC_TITLE_RE.test(title)) {
      return { nonBypassable: true, reason: 'system', code: 'uac-dialog', detail: title.slice(0, 80) }
    }
    if (CREDENTIAL_DIALOG_CLASSES.has(className) || SENSITIVE_WINDOW_TITLE_RE.test(title)) {
      return { nonBypassable: true, reason: 'system', code: 'sensitive-window', detail: (className || title).slice(0, 80) }
    }
  }
  return null
}

/**
 * 组合授权（纯函数）：无限制用户授权优先；否则系统禁令优先并使用策略 decide。
 * @param {object} identity
 * @param {{window?:object, policy:ComputerUseAppPolicy, systemDeny?:Function, unlimited?:boolean}} options
 */
function authorizeWindow(identity, { window = null, policy, systemDeny = classifySystemDeny, unlimited = false } = {}) {
  if (unlimited === true) {
    return {
      status: 'allowed',
      reason: 'unlimited-grant',
      matchedBy: 'user-grant',
      nonBypassable: false,
      fingerprint: identityFingerprintFor(identity)?.fingerprint || null
    }
  }
  if (!policy) throw new Error('缺少应用授权策略。')
  const system = systemDeny(identity, window)
  if (system) return { ...system, status: 'denied' }
  const decision = policy.decide(identity)
  return { ...decision, nonBypassable: false }
}

function capabilityError(name) {
  return Object.assign(new Error(`原生能力不可用：${name}`), { code: 'capability-unavailable', capability: name })
}

function decisionDenyError(authorization) {
  const code = authorization?.code
  const message = code === 'elevated'
    ? 'Computer Use 永久禁止控制已提权（管理员）或系统进程。'
    : code === 'uac-consent' || code === 'uac-dialog'
      ? 'Computer Use 永久禁止 UAC/安全桌面对话框。'
      : code === 'logon-ui'
        ? 'Computer Use 永久禁止登录/锁屏界面。'
        : code === 'sensitive-window' || code === 'sensitive-input-host'
          ? 'Computer Use 永久禁止系统凭据/敏感输入窗口。'
          : code === 'integrity-system' || code === 'system-process'
            ? 'Computer Use 永久禁止控制系统进程。'
            : authorization?.reason === 'denylist'
              ? 'Computer Use 拒绝控制该应用（用户已明确拒绝）。'
              : 'Computer Use 拒绝控制该窗口（应用策略）。'
  return Object.assign(new Error(message), {
    code: 'window-denied',
    reason: authorization?.reason || 'system',
    systemCode: code || null,
    matchedBy: authorization?.matchedBy || null
  })
}

// ---------------------------------------------------------------------------
// koffi 原生适配器
// ---------------------------------------------------------------------------

const WTD_CHOICE_FILE = 1
const WTD_UI_NONE = 2
const WTD_STATEACTION_VERIFY = 1
const WTD_STATEACTION_CLOSE = 2
const WTD_REVOCATION_CHECK_NONE = 0x10
const WINTRUST_ACTION_GENERIC_VERIFY_V2 = Buffer.from([0x6b, 0xc5, 0xaa, 0x00, 0x44, 0xcd, 0xd0, 0x11, 0x8c, 0xc2, 0x00, 0xc0, 0x4f, 0xc2, 0x95, 0xee])

const INPUT_MOUSE = 0
const INPUT_KEYBOARD = 1
const MOUSEEVENTF_LEFTDOWN = 0x0002
const MOUSEEVENTF_LEFTUP = 0x0004
const MOUSEEVENTF_RIGHTDOWN = 0x0008
const MOUSEEVENTF_RIGHTUP = 0x0010
const MOUSEEVENTF_WHEEL = 0x0800
const KEYEVENTF_UNICODE = 0x0004
const KEYEVENTF_KEYUP = 0x0002
const SM_XVIRTUALSCREEN = 76
const SM_YVIRTUALSCREEN = 77
const SM_CXVIRTUALSCREEN = 78
const SM_CYVIRTUALSCREEN = 79
const SRCCOPY = 0x00cc0020
const CAPTUREBLT = 0x40000000
const MAX_DESKTOP_PIXELS = 64 * 1024 * 1024
const GWL_EXSTYLE = -20
const WS_EX_TOOLWINDOW = 0x80
const DWMWA_CLOAKED = 14
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
const TOKEN_QUERY = 0x0008
const TokenIntegrityLevel = 25
const TokenElevation = 20

const MAX_VERSION_BLOCK_BYTES = 8 * 1024 * 1024
const MAX_WINDOW_TEXT_CHARS = 512
const MAX_TYPE_CHARS = 500

function win32String(buffer) {
  let end = 0
  while (end + 1 < buffer.length && buffer.readUInt16LE(end) !== 0) end += 2
  return buffer.toString('utf16le', 0, end)
}

function blankDetection(bgra, width, height) {
  if (!bgra || !width || !height) return true
  const first = bgra[0]
  const length = width * height * 4
  for (let index = 1; index < length; index += 1) {
    if (bgra[index] !== first) return false
  }
  return true
}

/**
 * 创建 koffi 原生适配器；非 Windows 或 koffi 不可用时返回 null。
 * 每个能力独立声明，失败只降级对应能力；运行时每个动作再次校验。
 */
function createKoffiWindowsAdapter({ requireKoffi = null } = {}) {
  if (process.platform !== 'win32') return null
  let koffi
  try {
    koffi = requireKoffi || require('koffi')
  } catch {
    return null
  }

  const caps = { enumeration: false, identity: false, integrity: false, signature: false, screenshot: false, input: false, aumid: false }
  const api = {}
  let EnumWindowsProc = null

  const declare = (key, factory) => {
    try {
      factory()
      caps[key] = true
    } catch {
      caps[key] = false
    }
  }

  declare('enumeration', () => {
    const user32 = koffi.load('user32.dll')
    api.user32 = user32
    EnumWindowsProc = koffi.proto('bool __stdcall EnumWindowsProc(intptr_t hwnd, intptr_t lparam)')
    api.EnumWindows = user32.func('EnumWindows', 'bool', [koffi.pointer(EnumWindowsProc), 'intptr_t'])
    api.IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(intptr_t hwnd)')
    api.GetWindowTextW = user32.func('int __stdcall GetWindowTextW(intptr_t hwnd, void *buf, int len)')
    api.GetClassNameW = user32.func('int __stdcall GetClassNameW(intptr_t hwnd, void *buf, int len)')
    api.GetWindowRect = user32.func('bool __stdcall GetWindowRect(intptr_t hwnd, void *rect)')
    api.GetWindowLongPtrW = user32.func('intptr_t __stdcall GetWindowLongPtrW(intptr_t hwnd, int index)')
    api.GetWindowThreadProcessId = user32.func('uint32 __stdcall GetWindowThreadProcessId(intptr_t hwnd, void *pid)')
  })

  declare('identity', () => {
    const kernel32 = koffi.load('kernel32.dll')
    const version32 = koffi.load('version.dll')
    const dwmapi = koffi.load('dwmapi.dll')
    api.kernel32 = kernel32
    api.version32 = version32
    api.OpenProcess = kernel32.func('void * __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)')
    api.CloseHandle = kernel32.func('bool __stdcall CloseHandle(void *handle)')
    api.QueryFullProcessImageNameW = kernel32.func('bool __stdcall QueryFullProcessImageNameW(void *process, uint32 flags, void *buf, void *size)')
    api.GetFileVersionInfoSizeW = version32.func('uint32 __stdcall GetFileVersionInfoSizeW(void *path, void *handle)')
    api.GetFileVersionInfoW = version32.func('bool __stdcall GetFileVersionInfoW(void *path, uint32 handle, uint32 size, void *data)')
    api.VerQueryValueW = version32.func('bool __stdcall VerQueryValueW(void *data, void *subblock, void *out, void *len)')
    api.DwmGetWindowAttribute = dwmapi.func('long __stdcall DwmGetWindowAttribute(intptr_t hwnd, uint32 attr, void *value, uint32 size)')
    // 说明：GetWindowTextW/GetClassNameW 在 enumeration 中声明，此处兜底。
    if (!api.GetWindowTextW) {
      api.GetWindowTextW = api.user32.func('int __stdcall GetWindowTextW(intptr_t hwnd, void *buf, int len)')
      api.GetClassNameW = api.user32.func('int __stdcall GetClassNameW(intptr_t hwnd, void *buf, int len)')
    }
  })

  declare('integrity', () => {
    const advapi32 = koffi.load('advapi32.dll')
    api.advapi32 = advapi32
    api.OpenProcessToken = advapi32.func('bool __stdcall OpenProcessToken(void *process, uint32 access, void *token)')
    api.GetTokenInformation = advapi32.func('bool __stdcall GetTokenInformation(void *token, uint32 cls, void *info, uint32 len, void *needed)')
  })

  declare('aumid', () => {
    api.GetApplicationUserModelId = koffi.load('kernel32.dll').func('long __stdcall GetApplicationUserModelId(void *process, void *size, void *id)')
  })

  declare('signature', () => {
    const wintrust = koffi.load('wintrust.dll')
    api.wintrust = wintrust
    api.WinVerifyTrust = wintrust.func('long __stdcall WinVerifyTrust(void *hwnd, void *pgActionID, void *pWVTData)')
  })

  declare('screenshot', () => {
    const user32 = api.user32 || koffi.load('user32.dll')
    const gdi32 = koffi.load('gdi32.dll')
    api.user32 = user32
    api.gdi32 = gdi32
    api.PrintWindow = user32.func('bool __stdcall PrintWindow(intptr_t hwnd, void *hdc, uint32 flags)')
    api.GetDC = user32.func('void * __stdcall GetDC(intptr_t hwnd)')
    api.ReleaseDC = user32.func('int __stdcall ReleaseDC(intptr_t hwnd, void *hdc)')
    api.GetClientRect = user32.func('bool __stdcall GetClientRect(intptr_t hwnd, void *rect)')
    api.GetSystemMetrics = user32.func('int __stdcall GetSystemMetrics(int index)')
    api.CreateCompatibleDC = gdi32.func('void * __stdcall CreateCompatibleDC(void *hdc)')
    api.CreateCompatibleBitmap = gdi32.func('void * __stdcall CreateCompatibleBitmap(void *hdc, int width, int height)')
    api.SelectObject = gdi32.func('void * __stdcall SelectObject(void *hdc, void *object)')
    api.DeleteObject = gdi32.func('bool __stdcall DeleteObject(void *object)')
    api.DeleteDC = gdi32.func('bool __stdcall DeleteDC(void *hdc)')
    api.GetDIBits = gdi32.func('int __stdcall GetDIBits(void *hdc, void *bitmap, uint32 start, uint32 lines, void *bits, void *info, uint32 usage)')
    api.BitBlt = gdi32.func('bool __stdcall BitBlt(void *dest, int x, int y, int width, int height, void *source, int sourceX, int sourceY, uint32 rop)')
  })

  declare('input', () => {
    const user32 = api.user32 || koffi.load('user32.dll')
    api.user32 = user32
    api.SetForegroundWindow = user32.func('bool __stdcall SetForegroundWindow(intptr_t hwnd)')
    api.GetForegroundWindow = user32.func('intptr_t __stdcall GetForegroundWindow(void)')
    api.SetCursorPos = user32.func('bool __stdcall SetCursorPos(int x, int y)')
    api.ClientToScreen = user32.func('bool __stdcall ClientToScreen(intptr_t hwnd, void *point)')
    if (!api.GetClientRect) api.GetClientRect = user32.func('bool __stdcall GetClientRect(intptr_t hwnd, void *rect)')
    const MouseInput = koffi.struct({ dx: 'long', dy: 'long', mouseData: 'uint32_t', dwFlags: 'uint32_t', time: 'uint32_t', dwExtraInfo: 'uintptr_t' })
    const KeyboardInput = koffi.struct({ wVk: 'uint16_t', wScan: 'uint16_t', dwFlags: 'uint32_t', time: 'uint32_t', dwExtraInfo: 'uintptr_t' })
    const HardwareInput = koffi.struct({ uMsg: 'uint32_t', wParamL: 'uint16_t', wParamH: 'uint16_t' })
    api.InputType = koffi.struct({
      type: 'uint32_t',
      u: koffi.union({ mi: MouseInput, ki: KeyboardInput, hi: HardwareInput })
    })
    api.SendInput = user32.func('SendInput', 'uint32', ['uint32', koffi.pointer(api.InputType), 'int'])
  })

  function hwndNumber(value) {
    return Number(value)
  }

  function isVisible(hwnd) { return Boolean(api.IsWindowVisible(hwnd)) }

  function isCloaked(hwnd) {
    try {
      const value = Buffer.alloc(4)
      const status = api.DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, value, 4)
      return status === 0 && value.readUInt32LE(0) !== 0
    } catch {
      return false // 无法探测 cloaked 时不额外剔除（保守保留窗口）
    }
  }

  function windowText(hwnd) {
    try {
      const buffer = Buffer.alloc(MAX_WINDOW_TEXT_CHARS * 2 + 2)
      const len = api.GetWindowTextW(hwnd, buffer, MAX_WINDOW_TEXT_CHARS)
      if (!len || len <= 0) return ''
      return win32String(buffer)
    } catch {
      return ''
    }
  }

  function windowClass(hwnd) {
    try {
      const buffer = Buffer.alloc(1024)
      const len = api.GetClassNameW(hwnd, buffer, 256)
      if (!len || len <= 0) return ''
      return win32String(buffer)
    } catch {
      return ''
    }
  }

  function listWindows({ includeCloaked = false } = {}) {
    if (!caps.enumeration) throw capabilityError('window-enumeration')
    const windows = []
    api.EnumWindows((rawHwnd, _lparam) => {
      const hwnd = hwndNumber(rawHwnd)
      if (!isVisible(hwnd)) return true
      const exStyle = Number(api.GetWindowLongPtrW(hwnd, GWL_EXSTYLE))
      if ((exStyle & WS_EX_TOOLWINDOW) !== 0) return true
      if (!includeCloaked && isCloaked(hwnd)) return true
      const pidBuf = Buffer.alloc(4)
      api.GetWindowThreadProcessId(hwnd, pidBuf)
      const pid = pidBuf.readUInt32LE(0)
      const rectBuf = Buffer.alloc(16)
      api.GetWindowRect(hwnd, rectBuf)
      const rect = {
        left: rectBuf.readInt32LE(0),
        top: rectBuf.readInt32LE(4),
        right: rectBuf.readInt32LE(8),
        bottom: rectBuf.readInt32LE(12)
      }
      if (rect.right - rect.left <= 0 || rect.bottom - rect.top <= 0) return true
      const entry = { hwnd, pid, rect, width: rect.right - rect.left, height: rect.bottom - rect.top }
      if (caps.identity) {
        entry.title = windowText(hwnd)
        entry.className = windowClass(hwnd)
      } else {
        entry.title = ''
        entry.className = ''
      }
      windows.push(entry)
      return true
    }, 0)
    return windows
  }

  function openProcess(pid) {
    return api.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
  }

  function processImagePath(processHandle) {
    const sizeBuf = Buffer.alloc(4)
    sizeBuf.writeUInt32LE(32768, 0)
    const buffer = Buffer.alloc(32768)
    const ok = api.QueryFullProcessImageNameW(processHandle, 0, buffer, sizeBuf)
    if (!ok) return null
    return win32String(buffer)
  }

  function processAumid(processHandle) {
    if (!caps.aumid) return null
    try {
      const sizeBuf = Buffer.alloc(4)
      sizeBuf.writeUInt32LE(512, 0)
      const buffer = Buffer.alloc(1024)
      const status = api.GetApplicationUserModelId(processHandle, sizeBuf, buffer)
      if (status !== 0) return null
      return win32String(buffer)
    } catch {
      return null
    }
  }

  function integrityOf(processHandle) {
    if (!caps.integrity) return { integrity: 'unknown', elevated: false }
    try {
      const tokenSlot = koffi.alloc('void *', 1)
      if (!api.OpenProcessToken(processHandle, TOKEN_QUERY, tokenSlot)) return { integrity: 'unknown', elevated: false }
      const token = koffi.decode(tokenSlot, 'void *')
      const info = Buffer.alloc(64)
      const needed = Buffer.alloc(4)
      let integrity = 'unknown'
      let elevated = false
      if (api.GetTokenInformation(token, TokenIntegrityLevel, info, 64, needed)) {
        const base = Number(koffi.address(info))
        // TOKEN_MANDATORY_LABEL：SID_AND_ATTRIBUTES{Sid 指针, Attributes}；SID 随缓冲区内联。
        const sidPointer = Number(koffi.decode(Buffer.from(info.buffer, info.byteOffset, info.length), 0, 'void *'))
        const offset = Number.isFinite(sidPointer) ? sidPointer - base : -1
        const sidOffset = offset >= 0 && offset + 12 < info.length ? offset : 16
        const count = info.readUInt8(sidOffset + 1)
        if (count > 0) {
          const value = info.readUInt32LE(sidOffset + 8 + 4 * (count - 1))
          integrity = value >= 16384 ? 'system' : value >= 12288 ? 'high' : value >= 8192 ? 'medium' : value >= 4096 ? 'low' : 'untrusted'
        }
      }
      const elevBuf = Buffer.alloc(8)
      if (api.GetTokenInformation(token, TokenElevation, elevBuf, 8, needed)) {
        elevated = elevBuf.readUInt32LE(0) !== 0
      }
      return { integrity, elevated }
    } catch {
      return { integrity: 'unknown', elevated: false }
    }
  }

  /** 在版本资源块内以「指针槽 + 地址减法」读取字符串字段（避免对非自有内存 decode）。 */
  function queryVersionString(data, dataBase, subblock) {
    try {
      const outSlot = koffi.alloc('void *', 1)
      const outLen = Buffer.alloc(4)
      const key = Buffer.from(`${subblock}\0`, 'utf16le')
      if (!api.VerQueryValueW(data, key, outSlot, outLen)) return null
      const pointer = Number(koffi.decode(outSlot, 'void *'))
      const offset = pointer - dataBase
      if (offset < 0 || offset >= data.length) return null
      const byteLength = outLen.readUInt32LE(0)
      return win32String(data.subarray(offset, Math.min(data.length, offset + byteLength + 2)))
    } catch {
      return null
    }
  }

  function versionStrings(exePath) {
    try {
      const pathBuf = Buffer.from(`${path.normalize(exePath)}\0`, 'utf16le')
      const size = api.GetFileVersionInfoSizeW(pathBuf, Buffer.alloc(4))
      if (!size || size > MAX_VERSION_BLOCK_BYTES) return {}
      const data = Buffer.alloc(size)
      if (!api.GetFileVersionInfoW(pathBuf, 0, size, data)) return {}
      const dataBase = Number(koffi.address(data))
      const translation = queryVersionString(data, dataBase, '\\VarFileInfo\\Translation')
      if (!translation) return {}
      // Translation 块是 2×uint16 的语言/代码页条目数组，取第一项。
      const lang = translation.charCodeAt(0)
      const codePage = translation.charCodeAt(1)
      const hex = `${lang.toString(16).padStart(4, '0')}${codePage.toString(16).padStart(4, '0')}`.toUpperCase()
      const result = {}
      const publisher = queryVersionString(data, dataBase, `\\StringFileInfo\\${hex}\\CompanyName`)
      const product = queryVersionString(data, dataBase, `\\StringFileInfo\\${hex}\\ProductName`)
      const program = queryVersionString(data, dataBase, `\\StringFileInfo\\${hex}\\FileDescription`)
      if (publisher) result.publisher = publisher
      if (product) result.product = product
      if (program) result.program = program
      return result
    } catch {
      return {}
    }
  }

  /**
   * Authenticode 验证（WinVerifyTrust）。证书 SHA-1 指纹无法在 koffi 3.1.6
   * 指针语义下安全读取，如实上报 thumbprint 不可用——验证结论真实、绝不伪造。
   */
  function verifySignature(exePath) {
    if (!caps.signature) {
      return { verified: false, thumbprint: null, status: 'unavailable', reason: 'signature-capability-unavailable', thumbprintAvailable: false }
    }
    try {
      const wtd = Buffer.alloc(128)
      const fileInfo = Buffer.alloc(32)
      const pathBuf = Buffer.from(`${path.normalize(exePath)}\0`, 'utf16le')
      const cbStruct = process.arch === 'x64' ? 0x50 : 0x4c
      wtd.writeUInt32LE(cbStruct, 0)
      wtd.writeUInt32LE(WTD_UI_NONE, 24)
      wtd.writeUInt32LE(WTD_CHOICE_FILE, 32)
      wtd.writeUInt32LE(WTD_STATEACTION_VERIFY, 48)
      wtd.writeUInt32LE(WTD_REVOCATION_CHECK_NONE, 72)
      fileInfo.writeUInt32LE(32, 0)
      koffi.encode(fileInfo, 8, 'void *', koffi.address(pathBuf))
      const pFileOffset = process.arch === 'x64' ? 40 : 36
      koffi.encode(wtd, pFileOffset, 'void *', koffi.address(fileInfo))
      const status = api.WinVerifyTrust(0, WINTRUST_ACTION_GENERIC_VERIFY_V2, wtd)
      try {
        wtd.writeUInt32LE(WTD_STATEACTION_CLOSE, 48)
        api.WinVerifyTrust(0, WINTRUST_ACTION_GENERIC_VERIFY_V2, wtd)
      } catch {
        // 状态清理失败不影响已得到的验证结论
      }
      if (status === 0) return { verified: true, thumbprint: null, status: 'verified', thumbprintAvailable: false }
      return { verified: false, thumbprint: null, status: 'not-signed', thumbprintAvailable: false }
    } catch (error) {
      return { verified: false, thumbprint: null, status: 'error', reason: String(error?.message || error).slice(0, 200), thumbprintAvailable: false }
    }
  }

  function desktopBounds() {
    if (!caps.screenshot) throw capabilityError('desktopScreenshot')
    const x = api.GetSystemMetrics(SM_XVIRTUALSCREEN)
    const y = api.GetSystemMetrics(SM_YVIRTUALSCREEN)
    const width = api.GetSystemMetrics(SM_CXVIRTUALSCREEN)
    const height = api.GetSystemMetrics(SM_CYVIRTUALSCREEN)
    if (width <= 0 || height <= 0 || width * height > MAX_DESKTOP_PIXELS) {
      throw Object.assign(new Error('Windows 虚拟桌面区域无效或过大。'), { code: 'screenshot-failed' })
    }
    return { x, y, width, height }
  }

  function captureDesktop() {
    const bounds = desktopBounds()
    const desktopDC = api.GetDC(0)
    if (!desktopDC) throw Object.assign(new Error('无法取得 Windows 虚拟桌面 DC。'), { code: 'screenshot-failed' })
    const memDC = api.CreateCompatibleDC(desktopDC)
    const bitmap = api.CreateCompatibleBitmap(desktopDC, bounds.width, bounds.height)
    if (!memDC || !bitmap) {
      if (bitmap) api.DeleteObject(bitmap)
      if (memDC) api.DeleteDC(memDC)
      api.ReleaseDC(0, desktopDC)
      throw Object.assign(new Error('无法创建全桌面截图缓冲区。'), { code: 'screenshot-failed' })
    }
    const previous = api.SelectObject(memDC, bitmap)
    const bits = Buffer.alloc(bounds.width * bounds.height * 4)
    let ok = false
    try {
      const rendered = api.BitBlt(memDC, 0, 0, bounds.width, bounds.height, desktopDC, bounds.x, bounds.y, SRCCOPY | CAPTUREBLT)
      if (rendered) {
        const bmi = Buffer.alloc(40)
        bmi.writeUInt32LE(40, 0)
        bmi.writeInt32LE(bounds.width, 4)
        bmi.writeInt32LE(-bounds.height, 8)
        bmi.writeUInt16LE(1, 12)
        bmi.writeUInt16LE(32, 14)
        ok = api.GetDIBits(memDC, bitmap, 0, bounds.height, bits, bmi, 0) !== 0
      }
    } finally {
      if (previous) api.SelectObject(memDC, previous)
      api.DeleteObject(bitmap)
      api.DeleteDC(memDC)
      api.ReleaseDC(0, desktopDC)
    }
    if (!ok) throw Object.assign(new Error('Windows 全桌面截图失败。'), { code: 'screenshot-failed' })
    return { ...bounds, format: 'bgra', bgra: bits, blank: blankDetection(bits, bounds.width, bounds.height) }
  }

  function captureWindow(hwnd) {
    if (!caps.screenshot) throw capabilityError('screenshot')
    const target = hwndNumber(hwnd)
    const windowDC = api.GetDC(target)
    if (!windowDC) throw Object.assign(new Error('无法取得目标窗口 DC。'), { code: 'screenshot-failed' })
    const rectBuf = Buffer.alloc(16)
    api.GetClientRect(target, rectBuf)
    const width = rectBuf.readInt32LE(8) - rectBuf.readInt32LE(0)
    const height = rectBuf.readInt32LE(12) - rectBuf.readInt32LE(4)
    if (width <= 0 || height <= 0 || width > 8192 || height > 8192) {
      api.ReleaseDC(target, windowDC)
      throw Object.assign(new Error('目标窗口客户区无效。'), { code: 'screenshot-failed' })
    }
    const memDC = api.CreateCompatibleDC(windowDC)
    const bitmap = api.CreateCompatibleBitmap(windowDC, width, height)
    if (!memDC || !bitmap) {
      if (bitmap) api.DeleteObject(bitmap)
      if (memDC) api.DeleteDC(memDC)
      api.ReleaseDC(target, windowDC)
      throw Object.assign(new Error('无法创建安全的窗口截图缓冲区。'), { code: 'screenshot-failed' })
    }
    const previous = api.SelectObject(memDC, bitmap)
    const bits = Buffer.alloc(width * height * 4)
    let ok = false
    try {
      const rendered = api.PrintWindow(target, memDC, 2) // PW_RENDERFULLCONTENT
      if (rendered) {
        const bmi = Buffer.alloc(40)
        bmi.writeUInt32LE(40, 0)
        bmi.writeInt32LE(width, 4)
        bmi.writeInt32LE(-height, 8) // 自上而下
        bmi.writeUInt16LE(1, 12)
        bmi.writeUInt16LE(32, 14)
        ok = api.GetDIBits(memDC, bitmap, 0, height, bits, bmi, 0) !== 0
      }
    } finally {
      if (previous) api.SelectObject(memDC, previous)
      api.DeleteObject(bitmap)
      api.DeleteDC(memDC)
      api.ReleaseDC(target, windowDC)
    }
    if (!ok) throw Object.assign(new Error('窗口截图渲染失败（该窗口可能使用无法捕获的渲染路径）。'), { code: 'screenshot-failed' })
    return { width, height, format: 'bgra', bgra: bits, blank: blankDetection(bits, width, height) }
  }

  function mouseEvent(flags) {
    return { type: INPUT_MOUSE, u: { mi: { dx: 0, dy: 0, mouseData: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 } } }
  }

  function requireTargetForeground(target) {
    api.SetForegroundWindow(target)
    const foreground = api.GetForegroundWindow()
    if (!foreground || Number(foreground) !== target) {
      throw Object.assign(new Error('无法安全聚焦目标窗口，已取消输入。'), { code: 'target-not-foreground' })
    }
  }

  function sendInputBatch(events) {
    if (!events.length) return 0
    const sent = Number(api.SendInput(events.length, events, koffi.sizeof(api.InputType)))
    if (sent !== events.length) throw Object.assign(new Error('Windows 未完整接收输入事件，已停止。'), { code: 'input-incomplete', sent, expected: events.length })
    return sent
  }

  function clickAtScreenPoint({ x, y, button = 'left' } = {}) {
    if (!caps.input) throw capabilityError('globalInput')
    const screenX = Math.round(Number(x))
    const screenY = Math.round(Number(y))
    if (!Number.isFinite(screenX) || !Number.isFinite(screenY) || !api.SetCursorPos(screenX, screenY)) {
      throw Object.assign(new Error('无法定位全桌面坐标，已取消点击。'), { code: 'desktop-coordinate-unavailable' })
    }
    const downFlag = button === 'right' ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_LEFTDOWN
    const upFlag = button === 'right' ? MOUSEEVENTF_RIGHTUP : MOUSEEVENTF_LEFTUP
    sendInputBatch([mouseEvent(downFlag), mouseEvent(upFlag)])
    return { delivered: true }
  }

  function sendGlobalMouseClick(parameters = {}) {
    return clickAtScreenPoint(parameters)
  }

  function sendMouseClick(hwnd, { x, y, button = 'left' } = {}) {
    if (!caps.input) throw capabilityError('input')
    const target = hwndNumber(hwnd)
    requireTargetForeground(target)
    const point = Buffer.alloc(8)
    point.writeInt32LE(Math.round(Number(x) || 0), 0)
    point.writeInt32LE(Math.round(Number(y) || 0), 4)
    if (!api.ClientToScreen(target, point)) throw Object.assign(new Error('无法解析目标窗口坐标，已取消点击。'), { code: 'target-coordinate-unavailable' })
    return clickAtScreenPoint({ x: point.readInt32LE(0), y: point.readInt32LE(4), button })
  }

  function scrollAtScreenPoint({ x, y, deltaY = 0 } = {}) {
    if (!caps.input) throw capabilityError('globalInput')
    const screenX = Math.round(Number(x))
    const screenY = Math.round(Number(y))
    if (!Number.isFinite(screenX) || !Number.isFinite(screenY) || !api.SetCursorPos(screenX, screenY)) {
      throw Object.assign(new Error('无法定位全桌面坐标，已取消滚动。'), { code: 'desktop-coordinate-unavailable' })
    }
    const delta = Math.max(-32767, Math.min(32767, Math.round(Number(deltaY) || 0)))
    if (delta === 0) return { delivered: true, sent: 0 }
    const wheel = { type: INPUT_MOUSE, u: { mi: { dx: 0, dy: 0, mouseData: delta, dwFlags: MOUSEEVENTF_WHEEL, time: 0, dwExtraInfo: 0 } } }
    sendInputBatch([wheel])
    return { delivered: true, sent: 1 }
  }

  function sendGlobalScroll(parameters = {}) {
    return scrollAtScreenPoint(parameters)
  }

  function sendScroll(hwnd, { x = null, y = null, deltaY = 0 } = {}) {
    if (!caps.input) throw capabilityError('input')
    const target = hwndNumber(hwnd)
    requireTargetForeground(target)
    const rect = Buffer.alloc(16)
    if (!api.GetClientRect(target, rect)) throw Object.assign(new Error('无法读取目标窗口区域，已取消滚动。'), { code: 'target-coordinate-unavailable' })
    const point = Buffer.alloc(8)
    const width = Math.max(1, rect.readInt32LE(8) - rect.readInt32LE(0))
    const height = Math.max(1, rect.readInt32LE(12) - rect.readInt32LE(4))
    point.writeInt32LE(Number.isFinite(Number(x)) ? Math.max(0, Math.min(width - 1, Math.round(Number(x)))) : Math.round(width / 2), 0)
    point.writeInt32LE(Number.isFinite(Number(y)) ? Math.max(0, Math.min(height - 1, Math.round(Number(y)))) : Math.round(height / 2), 4)
    if (!api.ClientToScreen(target, point)) throw Object.assign(new Error('无法解析目标窗口坐标，已取消滚动。'), { code: 'target-coordinate-unavailable' })
    return scrollAtScreenPoint({ x: point.readInt32LE(0), y: point.readInt32LE(4), deltaY })
  }

  function sendUnicodeText(text) {
    if (!caps.input) throw capabilityError('globalInput')
    const characters = Array.from(String(text || ''))
    const events = []
    for (const character of characters.slice(0, MAX_TYPE_CHARS)) {
      const code = character.codePointAt(0)
      if (code > 0xffff || code === 0) continue
      events.push({ type: INPUT_KEYBOARD, u: { ki: { wVk: 0, wScan: code, dwFlags: KEYEVENTF_UNICODE, time: 0, dwExtraInfo: 0 } } })
      events.push({ type: INPUT_KEYBOARD, u: { ki: { wVk: 0, wScan: code, dwFlags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP, time: 0, dwExtraInfo: 0 } } })
    }
    const sent = sendInputBatch(events)
    return { delivered: true, sent: Math.floor(sent / 2) }
  }

  function sendGlobalText(text) {
    return sendUnicodeText(text)
  }

  function sendText(hwnd, text) {
    if (!caps.input) throw capabilityError('input')
    requireTargetForeground(hwndNumber(hwnd))
    return sendUnicodeText(text)
  }

  function identityFor(hwnd) {
    if (!caps.identity) throw capabilityError('identity')
    const target = hwndNumber(hwnd)
    const pidBuf = Buffer.alloc(4)
    api.GetWindowThreadProcessId(target, pidBuf)
    const pid = pidBuf.readUInt32LE(0)
    if (!pid) throw Object.assign(new Error('无法取得窗口所属进程。'), { code: 'identity-unresolved' })
    const processHandle = openProcess(pid)
    if (!processHandle) throw Object.assign(new Error('无法打开目标进程查询身份。'), { code: 'identity-unresolved' })
    try {
      const exePath = processImagePath(processHandle)
      if (!exePath) throw Object.assign(new Error('无法解析目标进程 EXE 路径。'), { code: 'identity-unresolved' })
      const aumid = processAumid(processHandle)
      const integrity = integrityOf(processHandle)
      const version = versionStrings(exePath)
      const exeName = path.basename(exePath)
      return {
        hwnd: target,
        pid,
        exePath,
        exeName,
        program: version.program || exeName,
        product: version.product || exeName,
        publisher: version.publisher || '',
        aumid,
        aumidAvailable: caps.aumid,
        integrity: integrity.integrity,
        elevated: integrity.elevated,
        signature: verifySignature(exePath),
        fileHash: null // 由外层 async 补全（涉磁盘 IO）
      }
    } finally {
      if (api.CloseHandle) api.CloseHandle(processHandle)
    }
  }

  function capabilities() {
    return {
      platform: process.platform,
      koffi: true,
      windowEnumeration: caps.enumeration,
      identity: caps.identity,
      integrity: caps.integrity,
      aumid: caps.aumid,
      signatureVerification: caps.signature,
      signatureThumbprint: false, // koffi 3.1.6 无法安全读取证书指纹
      screenshot: caps.screenshot,
      desktopScreenshot: caps.screenshot,
      input: caps.input,
      globalInput: caps.input
    }
  }

  return {
    capabilities,
    listWindows,
    identityFor,
    desktopBounds,
    captureDesktop,
    captureWindow,
    sendGlobalMouseClick,
    sendGlobalScroll,
    sendGlobalText,
    sendMouseClick,
    sendScroll,
    sendText,
    verifySignature
  }
}

// ---------------------------------------------------------------------------
// 组合领域对象
// ---------------------------------------------------------------------------

const DEFAULT_HASH_CACHE_SIZE = 64

async function defaultHashFile(exePath) {
  const data = await readFile(exePath)
  return createHash('sha256').update(data).digest('hex')
}

class WindowsComputerUse {
  /**
   * @param {{ adapter?: object|null, policy?: ComputerUseAppPolicy,
   *           hashFile?: (exePath:string)=>Promise<string>,
   *           hashCacheSize?: number, unlimited?: boolean }} options
   */
  constructor({ adapter = createKoffiWindowsAdapter(), policy, hashFile = defaultHashFile, hashCacheSize = DEFAULT_HASH_CACHE_SIZE, unlimited = false } = {}) {
    this.adapter = adapter || null
    this.policy = policy || new ComputerUseAppPolicy()
    this.unlimited = unlimited === true
    this.hashFile = hashFile
    this.hashCache = new Map()
    this.hashCacheSize = Math.max(1, Math.min(512, Math.trunc(Number(hashCacheSize) || DEFAULT_HASH_CACHE_SIZE)))
  }

  capabilities() {
    const native = this.adapter ? this.adapter.capabilities() : null
    const policySnapshot = this.policy.snapshot()
    return {
      native,
      unlimited: this.unlimited,
      policy: {
        defaultAppAccess: policySnapshot.defaultAppAccess,
        allowlistCount: policySnapshot.allowlist.length,
        denylistCount: policySnapshot.denylist.length
      }
    }
  }

  #assertCapability(name) {
    if (!this.adapter) throw capabilityError(name)
    const caps = this.adapter.capabilities()
    if (caps[name] !== true) throw capabilityError(name)
  }

  #assertDesktopGrant() {
    if (!this.unlimited) throw Object.assign(new Error('全桌面 Computer Use 尚未获得用户授权。'), { code: 'computer-use-disabled' })
  }

  async #hashCached(exePath) {
    const info = await stat(exePath)
    const key = `${info.size}:${info.mtimeMs}:${path.normalize(exePath).toLowerCase()}`
    let cached = this.hashCache.get(key)
    if (cached === undefined) {
      cached = await this.hashFile(exePath)
      this.hashCache.set(key, cached)
      while (this.hashCache.size > this.hashCacheSize) {
        const oldest = this.hashCache.keys().next().value
        if (oldest == null) break
        this.hashCache.delete(oldest)
      }
    }
    return cached
  }

  /** 枚举可见顶层窗口（不解析身份，按需 bind）。 */
  async windows(options = {}) {
    this.#assertCapability('windowEnumeration')
    return this.adapter.listWindows(options)
  }

  /** 解析窗口的精确应用身份（含文件哈希），并附加系统禁令与策略裁决。 */
  async bind(hwnd, window = null) {
    this.#assertCapability('identity')
    const identity = this.adapter.identityFor(hwnd)
    if (identity.exePath && !identity.fileHash) {
      identity.fileHash = await this.#hashCached(identity.exePath)
    }
    const fingerprint = identityFingerprintFor(identity)
    return {
      identity,
      fingerprint: fingerprint ? fingerprint.fingerprint : null,
      authorization: authorizeWindow(identity, { window, policy: this.policy, unlimited: this.unlimited })
    }
  }

  /** 在用户授权后切换无限制桌面控制；默认关闭以保留旧安全语义。 */
  setUnlimited(enabled) {
    this.unlimited = enabled === true
    return this.unlimited
  }

  /** 组合授权裁决（纯逻辑，供上层 UI/确认门禁复用）。 */
  authorize(identity, window = null) {
    return authorizeWindow(identity, { window, policy: this.policy, unlimited: this.unlimited })
  }

  #gate(identity, window = null) {
    const authorization = this.authorize(identity, window)
    if (authorization.status === 'untrusted') {
      throw Object.assign(new Error('应用尚未获得持久授权（未在允许列表中）。'), {
        code: 'window-untrusted',
        reason: authorization.reason,
        matchedBy: authorization.matchedBy,
        fingerprint: authorization.fingerprint
      })
    }
    if (authorization.status !== 'allowed') throw decisionDenyError(authorization)
    return authorization
  }

  desktopBounds() {
    this.#assertCapability('desktopScreenshot')
    return this.adapter.desktopBounds()
  }

  async desktopScreenshot() {
    this.#assertDesktopGrant()
    this.#assertCapability('desktopScreenshot')
    return this.adapter.captureDesktop()
  }

  async globalClick(parameters = {}) {
    this.#assertDesktopGrant()
    this.#assertCapability('globalInput')
    return this.adapter.sendGlobalMouseClick(parameters)
  }

  async globalScroll(parameters = {}) {
    this.#assertDesktopGrant()
    this.#assertCapability('globalInput')
    return this.adapter.sendGlobalScroll(parameters)
  }

  async globalType({ text = '' } = {}) {
    this.#assertDesktopGrant()
    this.#assertCapability('globalInput')
    return this.adapter.sendGlobalText(String(text || ''))
  }

  async screenshot(hwnd, identity = null, window = null) {
    this.#assertCapability('screenshot')
    const resolved = identity || (await this.bind(hwnd, window)).identity
    this.#gate(resolved, window)
    const image = this.adapter.captureWindow(hwnd)
    return { ...image, identity: snapshotIdentity(resolved) }
  }

  async click(hwnd, { x = 0, y = 0, button = 'left' } = {}, identity = null, window = null) {
    this.#assertCapability('input')
    const resolved = identity || (await this.bind(hwnd, window)).identity
    this.#gate(resolved, window)
    return this.adapter.sendMouseClick(hwnd, { x, y, button })
  }

  async scroll(hwnd, { x = null, y = null, deltaY = 0 } = {}, identity = null, window = null) {
    this.#assertCapability('input')
    const resolved = identity || (await this.bind(hwnd, window)).identity
    this.#gate(resolved, window)
    return this.adapter.sendScroll(hwnd, { x, y, deltaY })
  }

  async type(hwnd, { text = '' } = {}, identity = null, window = null) {
    this.#assertCapability('input')
    const resolved = identity || (await this.bind(hwnd, window)).identity
    this.#gate(resolved, window)
    return this.adapter.sendText(hwnd, String(text || ''))
  }

  // ---- 策略代理（持久允许/拒绝/默认档位/快照） ----

  allow(identity, options) { return this.policy.allow(identity, options) }
  deny(identity, options) { return this.policy.deny(identity, options) }
  revoke(ruleLike, options) { return this.policy.revoke(ruleLike, options) }
  revokeAll(options) { return this.policy.revokeAll(options) }
  setDefaultAccess(value, options) { return this.policy.setDefaultAccess(value, options) }
  policySnapshot() { return this.policy.snapshot() }
}

function snapshotIdentity(identity) {
  if (!identity) return null
  return {
    exePath: identity.exePath,
    exeName: identity.exeName,
    program: identity.program,
    product: identity.product,
    publisher: identity.publisher,
    aumid: identity.aumid,
    integrity: identity.integrity,
    elevated: identity.elevated
  }
}

module.exports = {
  SYSTEM_PROCESS_NAMES,
  SYSTEM_PROCESS_SET,
  UAC_DIALOG_CLASS,
  CREDENTIAL_DIALOG_CLASSES,
  UAC_TITLE_RE,
  SENSITIVE_WINDOW_TITLE_RE,
  identityFingerprintFor,
  classifySystemDeny,
  authorizeWindow,
  createKoffiWindowsAdapter,
  WindowsComputerUse,
  blankDetection,
  DEFAULT_HASH_CACHE_SIZE
}